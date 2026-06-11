'use client';

import { useEffect, useState } from 'react';
import { Check, Circle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

const DISMISS_KEY = 'clipfire-onboarding-dismissed';

type Props = {
  hasConnectedAccount: boolean;
  hasFeedVideos: boolean;
  hasClips: boolean;
};

type Step = {
  label: string;
  done: boolean;
};

export function OnboardingChecklist({ hasConnectedAccount, hasFeedVideos, hasClips }: Props) {
  // Track mount + dismissed state separately so SSR markup matches client first paint
  // (avoids hydration mismatch — localStorage is only read after mount).
  const [mounted, setMounted] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setMounted(true);
    try {
      if (localStorage.getItem(DISMISS_KEY) === 'true') {
        setDismissed(true);
      }
    } catch {
      // localStorage unavailable (private mode etc.) — treat as not dismissed.
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, 'true');
    } catch {
      // Ignore — UI dismiss still works for this session.
    }
    setDismissed(true);
  };

  if (!mounted || dismissed) return null;

  const steps: Step[] = [
    { label: 'Account created', done: true },
    { label: 'Connect a source', done: hasConnectedAccount },
    { label: 'Wait for first video to ingest', done: hasFeedVideos },
    { label: 'Generate your first clip', done: hasClips },
  ];

  const allDone = steps.every((s) => s.done);
  const completedCount = steps.filter((s) => s.done).length;

  return (
    <div className="mb-6">
      <Card className="relative">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <CardTitle className="text-base">
                {allDone
                  ? "You're all set — welcome to Clipfire."
                  : "Welcome to Clipfire — let's make your first clip"}
              </CardTitle>
              <CardDescription>
                {allDone
                  ? 'You can dismiss this checklist whenever you like.'
                  : `${completedCount} of ${steps.length} complete`}
              </CardDescription>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleDismiss}
              className="-mr-2 -mt-1 h-8 px-2 text-muted-foreground hover:text-foreground"
              title="Dismiss checklist"
            >
              <X className="mr-1 h-4 w-4" />
              Dismiss
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ol className="space-y-2">
            {steps.map((step, idx) => (
              <li
                key={idx}
                className={cn(
                  'flex items-center gap-3 text-sm',
                  step.done ? 'text-foreground' : 'text-muted-foreground'
                )}
              >
                <span
                  className={cn(
                    'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border',
                    step.done
                      ? 'border-green-500 bg-green-500/10 text-green-600 dark:text-green-400'
                      : 'border-border bg-background'
                  )}
                  aria-hidden="true"
                >
                  {step.done ? (
                    <Check className="h-3 w-3" />
                  ) : (
                    <Circle className="h-2 w-2 fill-current opacity-40" />
                  )}
                </span>
                <span className={cn(step.done && 'line-through opacity-80')}>{step.label}</span>
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
