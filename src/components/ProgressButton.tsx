'use client';

import { cn } from '@/lib/utils';
import { Button, type ButtonProps } from '@/components/ui/button';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { SingleJobProgress, ProgressStatus } from '@/hooks/useJobProgress';

interface ProgressButtonProps extends Omit<ButtonProps, 'children'> {
  jobProgress: SingleJobProgress | null;
  idleLabel: string;
  completedLabel?: string;
  failedLabel?: string;
}

function getStatusColor(status: ProgressStatus) {
  switch (status) {
    case 'queued':
      return 'bg-yellow-500';
    case 'processing':
      return 'bg-blue-500';
    case 'completed':
      return 'bg-green-500';
    case 'failed':
      return 'bg-red-500';
    default:
      return 'bg-primary';
  }
}

export default function ProgressButton({
  jobProgress,
  idleLabel,
  completedLabel,
  failedLabel,
  className,
  variant = 'secondary',
  size = 'sm',
  ...rest
}: ProgressButtonProps) {
  const status = jobProgress?.status ?? 'idle';
  const progress = jobProgress?.progress ?? 0;
  const stage = jobProgress?.stage ?? null;
  const isActive = status === 'queued' || status === 'processing';
  const isComplete = status === 'completed';
  const isFailed = status === 'failed';

  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <Button
          variant={variant}
          size={size}
          disabled={isActive || rest.disabled}
          className={cn('relative overflow-hidden', className)}
          {...rest}
        >
          {isActive && (
            <div
              className={cn(
                'absolute inset-y-0 left-0 opacity-20 transition-all duration-500 ease-out',
                getStatusColor(status)
              )}
              style={{ width: `${progress}%` }}
            />
          )}
          <span className="relative z-10 flex items-center gap-2">
            {isActive ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>
                  {stage || 'Processing…'}
                  {progress > 0 && progress < 100 ? ` (${progress}%)` : ''}
                </span>
              </>
            ) : isComplete ? (
              <>
                <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                <span>{completedLabel ?? 'Done'}</span>
              </>
            ) : isFailed ? (
              <>
                <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                <span>{failedLabel ?? 'Failed — retry?'}</span>
              </>
            ) : (
              <span>{idleLabel}</span>
            )}
          </span>
        </Button>
      </div>
      {isActive && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              getStatusColor(status)
            )}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}
