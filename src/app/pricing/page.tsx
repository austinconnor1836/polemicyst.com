'use client';

import { useSession } from 'next-auth/react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
  free: string | boolean;
  pro: string | boolean;
  business: string | boolean;
}

const COMPARISON_ROWS: ComparisonRow[] = [
  { label: 'Sources (feeds)', free: '2', pro: '10', business: '50' },
  { label: 'Clips per month', free: '10', pro: '100', business: '500' },
  { label: 'Storage', free: '1 GB', pro: '25 GB', business: '100 GB' },
  { label: 'Ollama LLM', free: true, pro: true, business: true },
  { label: 'Gemini LLM', free: false, pro: true, business: true },
  { label: 'OpenAI / Anthropic LLMs', free: false, pro: false, business: true },
  { label: 'Auto-generate clips', free: false, pro: true, business: true },
  { label: 'Priority support', free: false, pro: false, business: true },
];

interface FaqItem {
  question: string;
  answer: string;
}

const FAQ_ITEMS: FaqItem[] = [
  {
    question: 'Can I change plans later?',
    answer:
      'Yes — upgrade or downgrade at any time from your Billing page. When you upgrade, the new limits apply immediately. When you downgrade, the change takes effect at the end of your current billing cycle.',
  },
  {
    question: 'What counts as a "source" (feed)?',
    answer:
      'A source is any YouTube channel, RSS feed, or other content stream you add for monitoring. Manual video uploads do not count toward your source limit.',
  },
  {
    question: 'Do unused clips roll over?',
    answer:
      'No — clip quotas reset at the start of each billing month. Storage usage, however, persists across months.',
  },
  {
    question: 'What LLM providers are available?',
    answer:
      'The Free plan includes Ollama (runs locally). Pro adds Gemini for multimodal analysis with frames and audio. Business unlocks all providers including OpenAI and Anthropic.',
  },
  {
    question: 'How does auto-generate work?',
    answer:
      'When enabled, new videos from your monitored sources are automatically scored and clipped without manual intervention. This feature is available on Pro and Business plans.',
  },
  {
    question: 'Can I cancel my subscription?',
    answer:
      'Yes — cancel anytime from the Billing page. You keep access to paid features until the end of your current billing period, then revert to the Free plan.',
  },
];

function FaqAccordion({ item }: { item: FaqItem }) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-lg glass:!border-white/[0.12]">
      <button
        className="flex w-full items-center justify-between px-5 py-4 text-left text-sm font-medium"
        onClick={() => setOpen(!open)}
      >
        <span>{item.question}</span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-muted transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-5 pb-4 text-sm text-muted leading-relaxed">{item.answer}</div>}
    </div>
  );
}

function CellValue({ value }: { value: string | boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <Check className="h-4 w-4 text-green-500 mx-auto" />
    ) : (
      <X className="h-4 w-4 text-muted/50 mx-auto" />
    );
  }
  return <span>{value}</span>;
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
        <Button variant="outline" className="w-full" onClick={() => router.push('/auth/signin')}>
          Sign in to get started
        </Button>
      );
    }

    if (currentPlan === null) {
      return (
        <Button variant="outline" className="w-full" disabled>
          Loading…
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

    if (planId === 'free' || PLAN_RANK[currentPlan] >= PLAN_RANK[planId]) {
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
        {loading === planId ? 'Redirecting…' : `Upgrade to ${PLANS[planId].name}`}
      </Button>
    );
  }

  return (
    <div className="min-h-screen px-4 py-16 glass:bg-transparent">
      <div className="mx-auto max-w-5xl space-y-20">
        {/* Header */}
        <div className="text-center space-y-4">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Simple, transparent pricing
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-muted">
            Choose the plan that fits your clip generation needs. Start free, upgrade when you need
            more power.
          </p>
        </div>

        {/* Plan Cards */}
        <div className="grid gap-6 md:grid-cols-3">
          {PLAN_ORDER.map((planId) => {
            const plan = PLANS[planId];
            const isPopular = planId === 'pro';

            return (
              <Card
                key={planId}
                className={`flex flex-col ${
                  isPopular
                    ? 'border-2 border-accent relative glass:border-accent/40 glass:shadow-[0_0_30px_rgba(233,69,96,0.12)]'
                    : ''
                }`}
              >
                {isPopular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-accent text-white">Most Popular</Badge>
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

        {/* Feature Comparison Table */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-center">Compare plans</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="py-3 pr-4 text-left font-medium text-muted">Feature</th>
                  {PLAN_ORDER.map((id) => (
                    <th key={id} className="py-3 px-4 text-center font-medium">
                      {PLANS[id].name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {COMPARISON_ROWS.map((row) => (
                  <tr key={row.label} className="border-b border-border/50">
                    <td className="py-3 pr-4 text-muted">{row.label}</td>
                    <td className="py-3 px-4 text-center">
                      <CellValue value={row.free} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <CellValue value={row.pro} />
                    </td>
                    <td className="py-3 px-4 text-center">
                      <CellValue value={row.business} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* FAQ */}
        <div className="space-y-6">
          <h2 className="text-2xl font-bold text-center">Frequently asked questions</h2>
          <div className="mx-auto max-w-2xl space-y-3">
            {FAQ_ITEMS.map((item) => (
              <FaqAccordion key={item.question} item={item} />
            ))}
          </div>
        </div>

        {/* Bottom CTA */}
        <div className="text-center space-y-4 pb-8">
          <h2 className="text-2xl font-bold">Ready to get started?</h2>
          <p className="text-muted">
            Start generating viral clips for free — no credit card required.
          </p>
          {status !== 'authenticated' ? (
            <Button size="lg" onClick={() => router.push('/auth/signin')}>
              Get Started Free
            </Button>
          ) : (
            <Button size="lg" onClick={() => router.push('/details')}>
              Go to Dashboard
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
