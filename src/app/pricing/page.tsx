'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Check, X, ChevronDown } from 'lucide-react';
import { PLANS, type PlanId } from '@/lib/plans';

type BillingInterval = 'monthly' | 'annual';

const PLAN_ORDER: PlanId[] = ['free', 'creator', 'pro', 'agency'];
const PLAN_RANK: Record<PlanId, number> = { free: 0, creator: 1, pro: 2, agency: 3 };

interface ComparisonRow {
  label: string;
  /** For the Watermark row, the boolean means "no watermark" (good). */
  isInverted?: boolean;
  values: Record<PlanId, string | boolean>;
}

function buildComparisonRows(): ComparisonRow[] {
  return [
    {
      label: 'Upload minutes/month',
      values: {
        free: String(PLANS.free.limits.uploadMinutesPerMonth),
        creator: String(PLANS.creator.limits.uploadMinutesPerMonth),
        pro: String(PLANS.pro.limits.uploadMinutesPerMonth),
        agency: String(PLANS.agency.limits.uploadMinutesPerMonth),
      },
    },
    {
      label: 'Connected accounts',
      values: {
        free: String(PLANS.free.limits.maxConnectedAccounts),
        creator: String(PLANS.creator.limits.maxConnectedAccounts),
        pro: String(PLANS.pro.limits.maxConnectedAccounts),
        agency: String(PLANS.agency.limits.maxConnectedAccounts),
      },
    },
    {
      label: 'Team seats',
      values: {
        free: String(PLANS.free.limits.teamSeats),
        creator: String(PLANS.creator.limits.teamSeats),
        pro: String(PLANS.pro.limits.teamSeats),
        agency: String(PLANS.agency.limits.teamSeats),
      },
    },
    {
      label: 'No watermark',
      values: {
        free: !PLANS.free.limits.watermark,
        creator: !PLANS.creator.limits.watermark,
        pro: !PLANS.pro.limits.watermark,
        agency: !PLANS.agency.limits.watermark,
      },
    },
    {
      label: 'Auto-generate clips',
      values: {
        free: PLANS.free.limits.autoGenerateClips,
        creator: PLANS.creator.limits.autoGenerateClips,
        pro: PLANS.pro.limits.autoGenerateClips,
        agency: PLANS.agency.limits.autoGenerateClips,
      },
    },
    {
      label: 'Best-in-class AI scoring',
      values: { free: true, creator: true, pro: true, agency: true },
    },
    {
      label: 'Multi-platform export',
      values: { free: true, creator: true, pro: true, agency: true },
    },
    {
      label: 'Priority support',
      values: {
        free: PLANS.free.limits.prioritySupport,
        creator: PLANS.creator.limits.prioritySupport,
        pro: PLANS.pro.limits.prioritySupport,
        agency: PLANS.agency.limits.prioritySupport,
      },
    },
  ];
}

const FAQ_ITEMS = [
  {
    q: 'Can I try Clipfire for free?',
    a: `Yes — the Free plan gives you ${PLANS.free.limits.maxConnectedAccounts} connected account and ${PLANS.free.limits.uploadMinutesPerMonth} upload minutes per month with no credit card required. Clips on the free tier include a Clipfire watermark.`,
  },
  {
    q: 'How does billing work?',
    a: 'Plans are billed monthly or annually via Stripe. Annual billing saves you around 20%. You can upgrade, downgrade, or cancel anytime from your Billing page.',
  },
  {
    q: 'What counts as an "upload minute"?',
    a: 'Each minute of source video you upload or connect to your feed counts toward your monthly limit. Exporting clips or re-processing the same video does not consume additional minutes.',
  },
  {
    q: 'What is the difference between monthly and annual billing?',
    a: 'Annual billing gives you a discounted per-month rate. You pay the full year upfront and save compared to paying month-to-month.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Absolutely. Upgrade or downgrade at any time through the Stripe customer portal. Changes take effect immediately, with prorated billing.',
  },
  {
    q: 'What happens when I hit my upload-minutes limit?',
    a: "You'll see a prompt to upgrade. No videos or clips are lost — you can wait for the next billing cycle or upgrade instantly to continue processing.",
  },
];

function ComparisonCell({ value }: { value: string | boolean }) {
  if (typeof value === 'string') {
    return <span className="text-sm font-medium">{value}</span>;
  }
  if (value) {
    return <Check className="h-5 w-5 text-green-500 mx-auto" />;
  }
  return <X className="h-4 w-4 text-muted mx-auto opacity-40" />;
}

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border-b border-border last:border-0">
      <button
        className="flex w-full items-center justify-between py-4 text-left text-sm font-medium hover:text-accent transition-colors"
        onClick={() => setOpen(!open)}
      >
        {q}
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <p className="pb-4 text-sm text-muted leading-relaxed">{a}</p>}
    </div>
  );
}

export default function PricingPage() {
  const { status } = useSession();
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState<PlanId | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>('monthly');

  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/user/subscription')
        .then((r) => r.json())
        .then((data) => setCurrentPlan((data.plan?.id as PlanId) ?? 'free'))
        .catch(() => setCurrentPlan('free'));
    }
  }, [status]);

  async function handleCheckout(planId: PlanId) {
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId, interval: billingInterval }),
      });
      const data = await res.json();
      if (data.url) {
        window.location.href = data.url;
      }
    } finally {
      setLoading(null);
    }
  }

  function renderButton(planId: PlanId) {
    if (status !== 'authenticated') {
      return (
        <Button
          variant={planId === 'creator' ? 'default' : 'outline'}
          className="w-full"
          onClick={() => router.push('/auth/signin')}
        >
          {planId === 'free' ? 'Get Started Free' : `Get Started with ${PLANS[planId].name}`}
        </Button>
      );
    }

    if (currentPlan === null) {
      return (
        <Button variant="outline" className="w-full" disabled>
          Loading...
        </Button>
      );
    }

    if (planId === currentPlan) {
      return (
        <Button variant="secondary" className="w-full" disabled>
          Current Plan
        </Button>
      );
    }

    if (planId === 'free') {
      if (PLAN_RANK[currentPlan] > PLAN_RANK[planId]) {
        return (
          <Button variant="outline" className="w-full" onClick={() => router.push('/billing')}>
            Manage Subscription
          </Button>
        );
      }
      return null;
    }

    if (currentPlan !== 'free') {
      return (
        <Button variant="outline" className="w-full" onClick={() => router.push('/billing')}>
          Manage Subscription
        </Button>
      );
    }

    return (
      <Button
        className="w-full"
        disabled={loading === planId}
        onClick={() => handleCheckout(planId)}
      >
        {loading === planId ? 'Redirecting...' : `Upgrade to ${PLANS[planId].name}`}
      </Button>
    );
  }

  const comparisonRows = buildComparisonRows();

  return (
    <div className="min-h-screen px-4 py-16 glass:bg-transparent">
      <div className="mx-auto max-w-6xl">
        {/* Header */}
        <div className="text-center mb-12">
          <Badge variant="secondary" className="mb-4 text-xs tracking-wide uppercase">
            Pricing
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
            Start free with {PLANS.free.limits.uploadMinutesPerMonth} upload minutes per month.
            Upgrade when you need more sources, minutes, or team seats.
          </p>
        </div>

        {/* Billing interval toggle */}
        <div className="flex items-center justify-center gap-3 mb-10">
          <span
            className={`text-sm font-medium ${billingInterval === 'monthly' ? 'text-foreground' : 'text-muted'}`}
          >
            Monthly
          </span>
          <button
            role="switch"
            aria-checked={billingInterval === 'annual'}
            onClick={() => setBillingInterval(billingInterval === 'monthly' ? 'annual' : 'monthly')}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
              billingInterval === 'annual' ? 'bg-accent' : 'bg-muted/40'
            }`}
          >
            <span
              className={`inline-block h-4 w-4 rounded-full bg-white shadow transition-transform ${
                billingInterval === 'annual' ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
          <span
            className={`text-sm font-medium ${billingInterval === 'annual' ? 'text-foreground' : 'text-muted'}`}
          >
            Annual
            <span className="ml-1.5 rounded-full bg-green-100 px-2 py-0.5 text-xs font-semibold text-green-700 dark:bg-green-900/30 dark:text-green-400">
              Save ~20%
            </span>
          </span>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const isPopular = planId === 'creator';
            const priceDisplay =
              billingInterval === 'annual' ? plan.annualPriceDisplay : plan.monthlyPriceDisplay;

            return (
              <Card
                key={planId}
                className={`flex flex-col ${isPopular ? 'border-2 border-blue-500 dark:border-blue-400 relative glass:border-blue-400/40 glass:shadow-[0_0_30px_rgba(59,130,246,0.15)]' : ''}`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-blue-500 text-white dark:bg-blue-400">Most Popular</Badge>
                  </div>
                )}
                <CardHeader>
                  <CardTitle className="text-xl">{plan.name}</CardTitle>
                  <CardDescription>{plan.description}</CardDescription>
                  <div className="mt-4">
                    <span className="text-4xl font-bold">{priceDisplay}</span>
                    <span className="text-muted">/mo</span>
                  </div>
                  {billingInterval === 'annual' && planId !== 'free' && (
                    <p className="text-xs text-muted mt-1">Billed annually</p>
                  )}
                </CardHeader>
                <CardContent className="flex-1">
                  <ul className="space-y-3">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2 text-sm">
                        <Check className="h-4 w-4 text-green-500 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </CardContent>
                <CardFooter>{renderButton(planId)}</CardFooter>
              </Card>
            );
          })}
        </div>

        {/* Feature comparison table */}
        <div className="mt-24">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Compare plans
          </h2>
          <p className="mt-3 text-center text-muted">
            See exactly what&apos;s included in each tier.
          </p>

          <div className="mt-10 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pr-4 text-left font-medium text-muted">Feature</th>
                  {PLAN_ORDER.map((planId) => (
                    <th key={planId} className="py-3 px-4 text-center font-semibold">
                      {PLANS[planId].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonRows.map((row) => (
                  <tr key={row.label} className="border-b border-border/50">
                    <td className="py-3 pr-4 text-muted">{row.label}</td>
                    {PLAN_ORDER.map((planId) => (
                      <td key={planId} className="py-3 px-4 text-center">
                        <ComparisonCell value={row.values[planId]} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="mt-24 mx-auto max-w-2xl">
          <h2 className="text-center text-2xl font-bold tracking-tight sm:text-3xl">
            Frequently asked questions
          </h2>
          <div className="mt-10 rounded-lg border border-border bg-surface/50 px-6">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.q} q={item.q} a={item.a} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="mt-24 text-center">
          <h2 className="text-2xl font-bold tracking-tight sm:text-3xl">
            Ready to find your next viral moment?
          </h2>
          <p className="mt-3 text-muted">Start free — no credit card required.</p>
          <div className="mt-8 flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
            <Button size="lg" asChild>
              <Link href="/auth/signin">Get Started Free</Link>
            </Button>
            {status !== 'authenticated' && (
              <Button variant="outline" size="lg" asChild>
                <Link href="/auth/signin">Sign In</Link>
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
