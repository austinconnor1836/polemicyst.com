'use client';

import { useCallback, useEffect, useState } from 'react';

export interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    limits: {
      maxFeeds: number;
      maxClipsPerMonth: number;
      maxStorageGb: number;
      llmProviders: string[];
      autoGenerateClips: boolean;
      prioritySupport: boolean;
    };
    features: string[];
  };
  usage: {
    feeds: number;
    clipsThisMonth: number;
    costThisMonth: { totalUsd: number; eventCount: number };
  };
  hasStripeCustomer: boolean;
}

export function useSubscription() {
  const [data, setData] = useState<SubscriptionData | null>(null);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch('/api/user/subscription');
      if (!res.ok) return;
      const json = await res.json();
      setData(json);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const isFree = data?.plan.id === 'free';

  const feedsNearLimit =
    data != null && data.usage.feeds >= Math.floor(data.plan.limits.maxFeeds * 0.8);
  const clipsNearLimit =
    data != null &&
    data.usage.clipsThisMonth >= Math.floor(data.plan.limits.maxClipsPerMonth * 0.8);

  return { data, loading, refetch, isFree, feedsNearLimit, clipsNearLimit };
}
