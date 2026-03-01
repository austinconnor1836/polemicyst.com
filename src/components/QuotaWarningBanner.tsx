'use client';

import Link from 'next/link';
import { AlertTriangle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { QuotaStatus } from '@/hooks/useSubscription';

interface QuotaWarningBannerProps {
  quota: QuotaStatus;
  planName: string;
  planId: string;
  /** Show only a specific quota type, or both */
  show?: 'feeds' | 'clips' | 'both';
}

interface WarningLine {
  label: string;
  used: number;
  limit: number;
  exceeded: boolean;
}

export function QuotaWarningBanner({
  quota,
  planName,
  planId,
  show = 'both',
}: QuotaWarningBannerProps) {
  const lines: WarningLine[] = [];

  if (show === 'feeds' || show === 'both') {
    if (quota.feeds.warning || quota.feeds.exceeded) {
      lines.push({
        label: 'Sources',
        used: quota.feeds.used,
        limit: quota.feeds.limit,
        exceeded: quota.feeds.exceeded,
      });
    }
  }

  if (show === 'clips' || show === 'both') {
    if (quota.clips.warning || quota.clips.exceeded) {
      lines.push({
        label: 'Clips this month',
        used: quota.clips.used,
        limit: quota.clips.limit,
        exceeded: quota.clips.exceeded,
      });
    }
  }

  if (lines.length === 0) return null;

  const hasExceeded = lines.some((l) => l.exceeded);
  const isFree = planId === 'free';

  const borderClass = hasExceeded
    ? 'border-red-200 dark:border-red-900/60 glass:border-red-500/20'
    : 'border-amber-200 dark:border-amber-900/60 glass:border-amber-500/20';

  const bgClass = hasExceeded
    ? 'bg-red-50/60 dark:bg-red-950/20 glass:bg-red-950/15'
    : 'bg-amber-50/60 dark:bg-amber-950/20 glass:bg-amber-950/15';

  const iconColor = hasExceeded
    ? 'text-red-600 dark:text-red-400'
    : 'text-amber-600 dark:text-amber-400';

  const textColor = hasExceeded
    ? 'text-red-800 dark:text-red-200'
    : 'text-amber-800 dark:text-amber-200';

  return (
    <Card className={`${borderClass} ${bgClass}`}>
      <CardContent className="flex items-start gap-3 p-4">
        <AlertTriangle className={`mt-0.5 h-5 w-5 shrink-0 ${iconColor}`} />
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-medium ${textColor}`}>
            {hasExceeded ? 'Quota limit reached' : 'Approaching quota limit'}
          </div>
          <div className={`mt-1 text-sm ${textColor} opacity-80`}>
            {lines.map((line) => (
              <span key={line.label} className="mr-4">
                {line.label}:{' '}
                <strong>
                  {line.used}/{line.limit}
                </strong>
                {line.exceeded ? ' (limit reached)' : ''}
              </span>
            ))}
            <span className="capitalize">({planName} plan)</span>
          </div>
          {(isFree || hasExceeded) && (
            <div className="mt-2">
              <Button asChild size="sm" variant={hasExceeded ? 'default' : 'secondary'}>
                <Link href="/pricing">Upgrade plan</Link>
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
