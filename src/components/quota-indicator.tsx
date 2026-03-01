'use client';

import { cn } from '@/lib/utils';

interface QuotaIndicatorProps {
  label: string;
  current: number;
  limit: number;
  className?: string;
}

export function QuotaIndicator({ label, current, limit, className }: QuotaIndicatorProps) {
  const pct = limit > 0 ? Math.min((current / limit) * 100, 100) : 0;
  const isNearLimit = pct >= 80;
  const isAtLimit = current >= limit;

  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span
          className={cn(
            'font-medium tabular-nums',
            isAtLimit
              ? 'text-red-600 dark:text-red-400'
              : isNearLimit
                ? 'text-amber-600 dark:text-amber-400'
                : 'text-foreground'
          )}
        >
          {current}/{limit}
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-300',
            isAtLimit
              ? 'bg-red-500'
              : isNearLimit
                ? 'bg-amber-500'
                : 'bg-primary'
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
