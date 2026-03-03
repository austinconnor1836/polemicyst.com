'use client';

import Link from 'next/link';
import { ShieldAlert, ArrowUpCircle } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export interface QuotaErrorInfo {
  code: 'QUOTA_EXCEEDED' | 'PLAN_RESTRICTED' | string;
  error: string;
  limit?: number;
  usage?: number;
  allowedProviders?: string[];
}

interface UpgradePromptProps {
  quotaError: QuotaErrorInfo;
  onDismiss?: () => void;
  className?: string;
}

export function UpgradePrompt({ quotaError, onDismiss, className }: UpgradePromptProps) {
  const isQuotaExceeded = quotaError.code === 'QUOTA_EXCEEDED';

  return (
    <Card
      className={`border-amber-300 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30 glass:border-amber-500/20 glass:bg-amber-950/20 ${className ?? ''}`}
    >
      <CardContent className="flex items-start gap-3 p-4">
        {isQuotaExceeded ? (
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        ) : (
          <ArrowUpCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-amber-800 dark:text-amber-200">
            {isQuotaExceeded ? 'Quota limit reached' : 'Plan upgrade required'}
          </div>
          <div className="mt-1 text-sm text-amber-800/80 dark:text-amber-200/80">
            {quotaError.error}
            {isQuotaExceeded && quotaError.limit != null && quotaError.usage != null && (
              <span className="ml-2 font-medium">
                ({quotaError.usage}/{quotaError.limit} used)
              </span>
            )}
          </div>
          <div className="mt-3 flex items-center gap-2">
            <Button asChild size="sm">
              <Link href="/pricing">Upgrade plan</Link>
            </Button>
            {onDismiss && (
              <Button variant="ghost" size="sm" onClick={onDismiss}>
                Dismiss
              </Button>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
