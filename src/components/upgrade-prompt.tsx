'use client';

import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ApiErrorBody {
  error: string;
  code?: 'QUOTA_EXCEEDED' | 'PLAN_RESTRICTED';
  limit?: number;
  usage?: number;
  allowedProviders?: string[];
}

export async function parseApiError(res: Response): Promise<ApiErrorBody> {
  try {
    return (await res.json()) as ApiErrorBody;
  } catch {
    return { error: res.statusText || 'Request failed' };
  }
}

export function UpgradePrompt({
  message,
  className,
}: {
  message: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50/70 p-4 dark:border-amber-900/60 dark:bg-amber-950/30 glass:border-amber-500/20 glass:bg-amber-950/20 ${className ?? ''}`}
    >
      <p className="text-sm text-amber-900 dark:text-amber-200">{message}</p>
      <Button asChild size="sm" className="w-fit">
        <Link href="/pricing">
          <ArrowUpRight className="mr-2 h-4 w-4" />
          Upgrade Plan
        </Link>
      </Button>
    </div>
  );
}
