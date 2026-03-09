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

interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    limits: { maxConnectedAccounts: number; maxClipsPerMonth: number };
    features: string[];
  };
  usage: { feeds: number; clipsThisMonth: number };
  hasStripeCustomer: boolean;
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
            <div>
              <p className="text-sm text-muted">Connected accounts</p>
              <p className="text-lg font-medium">
                {data.usage.feeds} / {plan.limits.maxConnectedAccounts}
              </p>
            </div>
            <div>
              <p className="text-sm text-muted">Clips this month</p>
              <p className="text-lg font-medium">
                {data.usage.clipsThisMonth} / {plan.limits.maxClipsPerMonth}
              </p>
            </div>
            <ul className="space-y-1">
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
