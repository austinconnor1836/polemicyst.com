'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowUpCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { ApiQuotaError } from '@/lib/api-error';

interface UpgradePromptDialogProps {
  error: ApiQuotaError | null;
  onClose: () => void;
}

export function UpgradePromptDialog({ error, onClose }: UpgradePromptDialogProps) {
  if (!error) return null;

  const isQuotaExceeded = error.code === 'QUOTA_EXCEEDED';
  const title = isQuotaExceeded ? 'Quota limit reached' : 'Feature not available on your plan';

  return (
    <Dialog open={!!error} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30 glass:bg-amber-900/20">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{error.error}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {isQuotaExceeded && error.limit != null && error.usage != null && (
            <div className="rounded-lg border bg-muted/40 p-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Current usage</span>
                <span className="font-semibold">
                  {error.usage} / {error.limit}
                </span>
              </div>
              <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-red-500 transition-all"
                  style={{ width: '100%' }}
                />
              </div>
            </div>
          )}

          <p className="text-sm text-muted-foreground">
            Upgrade your plan to unlock higher limits and additional features.
          </p>
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          <Button asChild>
            <Link href="/pricing">
              <ArrowUpCircle className="mr-2 h-4 w-4" />
              Upgrade plan
            </Link>
          </Button>
          <Button variant="outline" onClick={onClose}>
            Maybe later
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
