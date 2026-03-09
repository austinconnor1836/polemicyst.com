'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

export interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    limits: { maxConnectedAccounts: number; maxClipsPerMonth: number };
    features: string[];
  };
  usage: { feeds: number; clipsThisMonth: number };
  hasStripeCustomer: boolean;
}

export interface QuotaStatus {
  feeds: { used: number; limit: number; percent: number; warning: boolean; exceeded: boolean };
  clips: { used: number; limit: number; percent: number; warning: boolean; exceeded: boolean };
}

const WARNING_THRESHOLD = 0.8;

function computeQuotaStatus(data: SubscriptionData): QuotaStatus {
  const feedPercent =
    data.plan.limits.maxConnectedAccounts > 0
      ? data.usage.feeds / data.plan.limits.maxConnectedAccounts
      : 0;
  const clipPercent =
    data.plan.limits.maxClipsPerMonth > 0
      ? data.usage.clipsThisMonth / data.plan.limits.maxClipsPerMonth
      : 0;

  return {
    feeds: {
      used: data.usage.feeds,
      limit: data.plan.limits.maxConnectedAccounts,
      percent: feedPercent,
      warning: feedPercent >= WARNING_THRESHOLD && feedPercent < 1,
      exceeded: feedPercent >= 1,
    },
    clips: {
      used: data.usage.clipsThisMonth,
      limit: data.plan.limits.maxClipsPerMonth,
      percent: clipPercent,
      warning: clipPercent >= WARNING_THRESHOLD && clipPercent < 1,
      exceeded: clipPercent >= 1,
    },
  };
}

let cachedData: SubscriptionData | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000;

export function useSubscription() {
  const { status } = useSession();
  const [data, setData] = useState<SubscriptionData | null>(cachedData);
  const [loading, setLoading] = useState(!cachedData);
  const fetchedRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch('/api/user/subscription');
      if (!res.ok) return;
      const json = await res.json();
      cachedData = json;
      cacheTimestamp = Date.now();
      setData(json);
    } catch {
      // non-fatal
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (status !== 'authenticated') {
      setLoading(false);
      return;
    }

    const isCacheValid = cachedData && Date.now() - cacheTimestamp < CACHE_TTL_MS;
    if (isCacheValid) {
      setData(cachedData);
      setLoading(false);
      return;
    }

    if (fetchedRef.current) return;
    fetchedRef.current = true;
    refresh();
  }, [status, refresh]);

  const quota: QuotaStatus | null = data ? computeQuotaStatus(data) : null;

  return { data, loading, quota, refresh };
}
