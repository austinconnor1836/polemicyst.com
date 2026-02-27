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
import { Check } from 'lucide-react';
import { PLANS, type PlanId } from '@/lib/plans';

const PLAN_ORDER: PlanId[] = ['free', 'pro', 'business'];
const PLAN_RANK: Record<PlanId, number> = { free: 0, pro: 1, business: 2 };

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

    if (currentPlan !== 'free' && PLAN_RANK[currentPlan] > PLAN_RANK[planId]) {
      return (
        <Button variant="outline" className="w-full" onClick={() => router.push('/billing')}>
          Manage Subscription
        </Button>
      );
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
        <div className="text-center mb-12">
          <h1 className="text-4xl font-bold tracking-tight">Pricing</h1>
          <p className="mt-4 text-lg text-muted">
            Choose the plan that fits your clip generation needs.
          </p>
        </div>

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
      </div>
    </div>
  );
}
