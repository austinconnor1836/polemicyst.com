'use client';

import { cn } from '@/lib/utils';

interface ModeSelectorProps {
  mode: 'pre-synced' | 'timeline';
  onChange: (mode: 'pre-synced' | 'timeline') => void;
}

export function ModeSelector({ mode, onChange }: ModeSelectorProps) {
  return (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => onChange('pre-synced')}
        className={cn(
          'flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors',
          mode === 'pre-synced'
            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'
        )}
      >
        <div className="font-semibold">Pre-synced</div>
        <div className="mt-1 text-xs opacity-80">
          Both videos same length — just composite them together
        </div>
      </button>
      <button
        type="button"
        onClick={() => onChange('timeline')}
        className={cn(
          'flex-1 rounded-lg border px-4 py-3 text-sm font-medium transition-colors',
          mode === 'timeline'
            ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
            : 'border-border bg-background text-muted-foreground hover:bg-muted'
        )}
      >
        <div className="font-semibold">Timeline</div>
        <div className="mt-1 text-xs opacity-80">Place reference clips at specific timestamps</div>
      </button>
    </div>
  );
}
