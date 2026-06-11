'use client';

import { Suspense } from 'react';
import { useSession } from 'next-auth/react';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import toast from 'react-hot-toast';
import { ThemedToaster } from '@/components/themed-toaster';
import { PLANS, type PlanId } from '@/lib/plans';

/**
 * Shape returned by GET /api/user/subscription.
 *
 * NOTE(T010-followup): The backend API does not yet return `uploadMinutesUsed`.
 * Once T010 (pricing-backend) lands and wires `UsageMonth.processedMinutes` into
 * the response, replace the `?` with a required field and remove this comment.
 */
interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    limits: {
      maxConnectedAccounts: number;
      uploadMinutesPerMonth: number;
      // Legacy field kept until the API migration is complete.
      maxClipsPerMonth?: number;
    };
    features: string[];
  };
  usage: {
    feeds: number;
    /** Available once T010 adds UsageMonth.processedMinutes to the response. */
    uploadMinutesUsed?: number;
    // Legacy field kept for backward compat during the transition.
    clipsThisMonth?: number;
  };
  hasStripeCustomer: boolean;
}

function UsageMeter({
  label,
  used,
  limit,
  isApproximate,
}: {
  label: string;
  used: number;
  limit: number;
  isApproximate?: boolean;
}) {
  const percent = limit > 0 ? Math.min(used / limit, 1) : 0;
  const isWarning = percent >= 0.8 && percent < 1;
  const isExceeded = percent >= 1;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <p className="text-sm text-muted">{label}</p>
        {isApproximate && (
          <span className="text-xs text-muted italic">(live data coming soon)</span>
        )}
      </div>
      <p
        className={`text-lg font-medium ${isExceeded ? 'text-red-500' : isWarning ? 'text-yellow-500' : ''}`}
      >
        {used.toLocaleString()} / {limit.toLocaleString()}
      </p>
      <div className="mt-1.5 h-1.5 rounded-full bg-muted/20 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all ${
            isExceeded ? 'bg-red-500' : isWarning ? 'bg-yellow-500' : 'bg-accent'
          }`}
          style={{ width: `${percent * 100}%` }}
        />
      </div>
    </div>
  );
}

function BillingContent() {
  const { status } = useSession();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    if (status === 'authenticated') {
      fetch('/api/user/subscription')
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    }
  }, [status]);

  useEffect(() => {
    if (searchParams.get('session_id')) {
      toast.success('Subscription activated! Welcome to your new plan.');
      // Clean up the URL
      window.history.replaceState({}, '', '/billing');
    }
  }, [searchParams]);

  async function handleManage() {
    setPortalLoading(true);
    try {
      const res = await fetch('/api/stripe/create-portal-session', { method: 'POST' });
      const result = await res.json();
      if (result.url) {
        window.location.href = result.url;
      } else {
        toast.error(result.error || 'Failed to open billing portal');
      }
    } catch {
      toast.error('Something went wrong');
    } finally {
      setPortalLoading(false);
    }
  }

  if (status === 'loading' || !data) {
    return (
      <div className="min-h-screen flex items-center justify-center glass:bg-transparent">
        <p className="text-muted">Loading...</p>
      </div>
    );
  }

  const plan = data.plan;
  const isFree = plan.id === 'free';

  // Resolve the minute limit from the PLANS constant as a safe fallback if the API
  // returns the old shape without `uploadMinutesPerMonth`.
  const minuteLimit =
    plan.limits.uploadMinutesPerMonth ??
    (plan.id in PLANS ? PLANS[plan.id as PlanId].limits.uploadMinutesPerMonth : 0);

  const minutesUsed = data.usage.uploadMinutesUsed ?? 0;
  const isMinutesApproximate = data.usage.uploadMinutesUsed === undefined;

  return (
    <div className="min-h-screen px-4 py-16 glass:bg-transparent">
      <ThemedToaster position="top-center" />
      <div className="mx-auto max-w-2xl space-y-6">
        <h1 className="text-3xl font-bold">Billing</h1>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-3">
              <CardTitle>Current Plan</CardTitle>
              <Badge variant={isFree ? 'secondary' : 'default'}>{plan.name}</Badge>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <UsageMeter
              label="Upload minutes this month"
              used={minutesUsed}
              limit={minuteLimit}
              isApproximate={isMinutesApproximate}
            />
            <UsageMeter
              label="Connected accounts"
              used={data.usage.feeds}
              limit={plan.limits.maxConnectedAccounts}
            />
            <ul className="space-y-1 pt-2">
              {plan.features.map((f) => (
                <li key={f} className="text-sm">
                  {f}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>

        <div className="flex gap-3">
          {isFree && <Button onClick={() => router.push('/pricing')}>Upgrade Plan</Button>}
          {!isFree && data.hasStripeCustomer && (
            <Button variant="outline" onClick={handleManage} disabled={portalLoading}>
              {portalLoading ? 'Opening...' : 'Manage Subscription'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen flex items-center justify-center glass:bg-transparent">
          <p className="text-muted">Loading...</p>
        </div>
      }
    >
      <BillingContent />
    </Suspense>
  );
}
