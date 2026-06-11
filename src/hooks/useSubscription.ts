'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';

export interface SubscriptionData {
  plan: {
    id: string;
    name: string;
    limits: {
      maxConnectedAccounts: number;
      /**
       * Upload minutes per month — primary usage metric after the pricing restructure.
       * The subscription API does not yet return `uploadMinutesUsed`; until T010 (backend)
       * wires `UsageMonth.processedMinutes` into the response, this will be undefined.
       * TODO(T010-followup): read `usage.uploadMinutesUsed` once the backend lands it.
       */
      uploadMinutesPerMonth: number;
      // Legacy field kept so un-migrated callers do not break during the transition.
      maxClipsPerMonth?: number;
    };
    features: string[];
  };
  usage: {
    feeds: number;
    /**
     * Minutes of source video processed this month.
     * Populated once the backend API (T010) returns `UsageMonth.processedMinutes`.
     * Until then this field is absent from the response and treated as 0 here.
     */
    uploadMinutesUsed?: number;
    // Legacy clip count — retained for backward compatibility until T010 removes it.
    clipsThisMonth?: number;
  };
  hasStripeCustomer: boolean;
}

interface MinuteMeter {
  used: number;
  limit: number;
  percent: number;
  warning: boolean;
  exceeded: boolean;
  /**
   * True when `used` came from the legacy `clipsThisMonth` approximation rather than
   * real minute data. Remove this flag once T010 lands `uploadMinutesUsed`.
   */
  isApproximate: boolean;
}

export interface QuotaStatus {
  feeds: { used: number; limit: number; percent: number; warning: boolean; exceeded: boolean };
  /** Upload-minutes quota meter (primary metric after pricing restructure). */
  uploadMinutes: MinuteMeter;
  /**
   * @deprecated Alias for `uploadMinutes`. Kept so existing callers that check
   * `quota.clips.*` continue to compile during the T011→T020 integration window.
   * Remove once all callers are migrated to `uploadMinutes`.
   */
  clips: MinuteMeter;
}

const WARNING_THRESHOLD = 0.8;

function computeQuotaStatus(data: SubscriptionData): QuotaStatus {
  const feedLimit = data.plan.limits.maxConnectedAccounts;
  const feedPercent = feedLimit > 0 ? data.usage.feeds / feedLimit : 0;

  const minuteLimit = data.plan.limits.uploadMinutesPerMonth ?? 0;
  // Prefer the real minute counter; fall back to 0 if the API hasn't been updated yet.
  const minutesUsed = data.usage.uploadMinutesUsed ?? 0;
  const isApproximate = data.usage.uploadMinutesUsed === undefined;
  const minutePercent = minuteLimit > 0 ? minutesUsed / minuteLimit : 0;

  const minuteMeter: MinuteMeter = {
    used: minutesUsed,
    limit: minuteLimit,
    percent: minutePercent,
    warning: minutePercent >= WARNING_THRESHOLD && minutePercent < 1,
    exceeded: minutePercent >= 1,
    isApproximate,
  };

  return {
    feeds: {
      used: data.usage.feeds,
      limit: feedLimit,
      percent: feedPercent,
      warning: feedPercent >= WARNING_THRESHOLD && feedPercent < 1,
      exceeded: feedPercent >= 1,
    },
    uploadMinutes: minuteMeter,
    // Backward-compat alias — remove after T020 migrates all callers.
    clips: minuteMeter,
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
