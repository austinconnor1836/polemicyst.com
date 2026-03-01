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

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'business'];
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

interface ComparisonRow {
  label: string;
  values: Record<PlanId, string | boolean>;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  {
    label: 'Monthly price',
    values: { free: '$0', pro: '$19', business: '$49' },
  },
  {
    label: 'Video sources (feeds)',
    values: { free: '2', pro: '10', business: '50' },
  },
  {
    label: 'Clips per month',
    values: { free: '10', pro: '100', business: '500' },
  },
  {
    label: 'Storage',
    values: { free: '1 GB', pro: '25 GB', business: '100 GB' },
  },
  {
    label: 'Ollama LLM',
    values: { free: true, pro: true, business: true },
  },
  {
    label: 'Gemini LLM',
    values: { free: false, pro: true, business: true },
  },
  {
    label: 'OpenAI & Anthropic LLMs',
    values: { free: false, pro: false, business: true },
  },
  {
    label: 'Auto-generate clips',
    values: { free: false, pro: true, business: true },
  },
  {
    label: 'Multi-platform export',
    values: { free: true, pro: true, business: true },
  },
  {
    label: 'Priority support',
    values: { free: false, pro: false, business: true },
  },
];

const FAQ_ITEMS = [
  {
    q: 'Can I try Polemicyst for free?',
    a: 'Yes — the Free plan gives you 2 video sources, 10 clips per month, and 1 GB of storage with no credit card required.',
  },
  {
    q: 'How does billing work?',
    a: 'Plans are billed monthly via Stripe. You can upgrade, downgrade, or cancel anytime from your Billing page.',
  },
  {
    q: 'What counts as a "clip"?',
    a: 'Each clip generated from a source video counts toward your monthly limit. Re-exporting the same clip to a different platform does not use an additional credit.',
  },
  {
    q: 'What LLM providers are available?',
    a: 'Free users get Ollama (runs locally, zero cost). Pro adds Gemini multimodal scoring. Business unlocks all providers including OpenAI and Anthropic for maximum scoring accuracy.',
  },
  {
    q: 'Can I change plans later?',
    a: 'Absolutely. Upgrade or downgrade at any time through the Stripe customer portal. Changes take effect immediately, with prorated billing.',
  },
  {
    q: 'What happens when I hit my clip limit?',
    a: "You'll see a prompt to upgrade. No clips are lost — you can wait for the next billing cycle or upgrade instantly to continue generating.",
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
  const { data: session, status } = useSession();
  const router = useRouter();
  const [currentPlan, setCurrentPlan] = useState<PlanId | null>(null);
  const [loading, setLoading] = useState<PlanId | null>(null);

  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/user/subscription')
        .then((r) => r.json())
        .then((data) => setCurrentPlan(data.plan?.id ?? 'free'))
        .catch(() => setCurrentPlan('free'));
    }
  }, [status]);

  async function handleCheckout(planId: PlanId) {
    setLoading(planId);
    try {
      const res = await fetch('/api/stripe/create-checkout-session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId }),
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
          variant={planId === 'pro' ? 'default' : 'outline'}
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

  return (
    <div className="min-h-screen px-4 py-16 glass:bg-transparent">
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="text-center mb-16">
          <Badge variant="secondary" className="mb-4 text-xs tracking-wide uppercase">
            Pricing
          </Badge>
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mt-4 text-lg text-muted max-w-2xl mx-auto">
            Start free with 10 clips per month. Upgrade when you need more sources, clips, or AI
            scoring power.
          </p>
        </div>

        {/* Plan cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const isPopular = planId === 'pro';

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
                    <span className="text-4xl font-bold">{plan.monthlyPriceDisplay}</span>
                    <span className="text-muted">/mo</span>
                  </div>
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
                {COMPARISON_ROWS.map((row) => (
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
