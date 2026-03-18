'use client';

import { cn } from '@/lib/utils';

interface LayoutPreviewProps {
  layout: 'mobile' | 'landscape';
  hasReference: boolean;
  hasPortraitRef?: boolean;
  hasLandscapeRef?: boolean;
  className?: string;
}

/** Mini mockup of the portrait-ref landscape layout */
function PortraitRefMockup({ compact }: { compact?: boolean }) {
  // ~9:16 ref at full output height ≈ 31% of 16:9 width
  const refPct = 32;
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm border border-border bg-muted/30',
        compact ? 'h-full w-full' : 'w-36 h-20'
      )}
    >
      {/* Creator fills left */}
      <div
        className="absolute top-0 left-0 bottom-0 flex items-center justify-center bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-[7px] font-medium"
        style={{ width: `${100 - refPct}%` }}
      >
        Creator
      </div>
      {/* Portrait ref flush-right */}
      <div
        className="absolute top-0 right-0 bottom-0 flex items-center justify-center bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[7px] font-medium"
        style={{ width: `${refPct}%` }}
      >
        Ref
      </div>
      <div
        className="absolute top-0 bottom-0 bg-border"
        style={{ left: `${100 - refPct}%`, width: 1 }}
      />
    </div>
  );
}

/** Mini mockup of the landscape-ref layout */
function LandscapeRefMockup({ compact }: { compact?: boolean }) {
  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-sm border border-border bg-muted/30',
        compact ? 'h-full w-full' : 'w-36 h-20'
      )}
    >
      {/* Reference fills frame */}
      <div className="absolute inset-0 flex items-center justify-center bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300 text-[7px] font-medium">
        Reference
      </div>
      {/* Creator PIP bottom-right */}
      <div
        className="absolute flex items-center justify-center rounded-sm border border-white/60 bg-green-200 text-green-800 dark:bg-green-800 dark:text-green-200 text-[6px] font-medium shadow-sm"
        style={{ width: '25%', height: '25%', bottom: 2, right: 2 }}
      >
        You
      </div>
    </div>
  );
}

export function LayoutPreview({
  layout,
  hasReference,
  hasPortraitRef,
  hasLandscapeRef,
  className,
}: LayoutPreviewProps) {
  const isMobile = layout === 'mobile';

  // For landscape with both ref types, show two stacked mini-previews
  const showBoth = !isMobile && hasReference && hasPortraitRef && hasLandscapeRef;

  if (isMobile) {
    return (
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <div className="relative w-20 h-36 overflow-hidden rounded-md border border-border bg-muted/30">
          <div
            className={cn(
              'absolute top-0 left-0 right-0 flex items-center justify-center text-[8px] font-medium',
              hasReference
                ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                : 'bg-muted text-muted-foreground'
            )}
            style={{ height: '50%' }}
          >
            {hasReference ? 'Reference' : 'Creator'}
          </div>
          <div
            className="absolute bottom-0 left-0 right-0 flex items-center justify-center bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-[8px] font-medium"
            style={{ height: '50%' }}
          >
            Creator
          </div>
          {hasReference && <div className="absolute top-1/2 left-0 right-0 h-px bg-border" />}
        </div>
        <span className="text-xs text-muted-foreground">720x1280 (9:16)</span>
      </div>
    );
  }

  // Landscape: no reference
  if (!hasReference) {
    return (
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <div className="relative w-36 h-20 overflow-hidden rounded-md border border-border bg-muted/30">
          <div className="absolute inset-0 flex items-center justify-center bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300 text-[8px] font-medium">
            Creator
          </div>
        </div>
        <span className="text-xs text-muted-foreground">1280x720 (16:9)</span>
      </div>
    );
  }

  // Landscape: both portrait + landscape refs — show two separate previews side by side
  if (showBoth) {
    return (
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <div className="flex gap-2">
          <LandscapeRefMockup />
          <PortraitRefMockup />
        </div>
        <span className="text-xs text-muted-foreground">1280x720 (16:9)</span>
      </div>
    );
  }

  // Landscape: only portrait refs
  if (hasPortraitRef) {
    return (
      <div className={cn('flex flex-col items-center gap-1', className)}>
        <PortraitRefMockup />
        <span className="text-xs text-muted-foreground">1280x720 (16:9)</span>
      </div>
    );
  }

  // Landscape: only landscape refs
  return (
    <div className={cn('flex flex-col items-center gap-1', className)}>
      <LandscapeRefMockup />
      <span className="text-xs text-muted-foreground">1280x720 (16:9)</span>
    </div>
  );
}
