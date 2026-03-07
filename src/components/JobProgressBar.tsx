'use client';

import { cn } from '@/lib/utils';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import type { SingleJobProgress, ProgressStatus } from '@/hooks/useJobProgress';

interface JobProgressBarProps {
  jobProgress: SingleJobProgress | null;
  label?: string;
  className?: string;
}

function getBarColor(status: ProgressStatus) {
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

export default function JobProgressBar({ jobProgress, label, className }: JobProgressBarProps) {
  if (!jobProgress) return null;

  const { status, progress, stage } = jobProgress;
  const isActive = status === 'queued' || status === 'processing';
  const isComplete = status === 'completed';
  const isFailed = status === 'failed';

  if (status === 'idle') return null;

  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex items-center gap-2 text-sm">
        {isActive && <Loader2 className="h-4 w-4 animate-spin text-blue-500" />}
        {isComplete && <CheckCircle2 className="h-4 w-4 text-green-500" />}
        {isFailed && <XCircle className="h-4 w-4 text-red-500" />}
        <span className="text-muted-foreground">
          {label && <span className="font-medium text-foreground">{label}: </span>}
          {stage || status}
          {isActive && progress > 0 && progress < 100 ? ` (${progress}%)` : ''}
        </span>
      </div>
      {isActive && (
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={cn(
              'h-full rounded-full transition-all duration-500 ease-out',
              getBarColor(status)
            )}
            style={{ width: `${Math.max(progress, 2)}%` }}
          />
        </div>
      )}
    </div>
  );
}
