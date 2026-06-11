'use client';

import { VideoCard } from '@/components/ui/video-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';

interface CompositionVideoPanelProps {
  src: string;
  label: string;
  badge?: React.ReactNode;
  sublabel?: React.ReactNode;
  onClick?: () => void;
  onDelete?: () => void;
  deleting?: boolean;
  disabled?: boolean;
  videoRef?: React.Ref<HTMLVideoElement>;
  onTimeUpdate?: (currentTime: number) => void;
  extraOverlay?: React.ReactNode;
}

export function CompositionVideoPanel({
  src,
  label,
  badge,
  sublabel,
  onClick,
  onDelete,
  deleting,
  disabled,
  videoRef,
  onTimeUpdate,
  extraOverlay,
}: CompositionVideoPanelProps) {
  return (
    <VideoCard
      size="md"
      src={src}
      label={label}
      badge={
        badge ? (
          typeof badge === 'string' ? (
            <Badge variant="secondary" className="text-[11px] shrink-0">
              {badge}
            </Badge>
          ) : (
            badge
          )
        ) : undefined
      }
      sublabel={sublabel}
      videoRef={videoRef}
      onTimeUpdate={onTimeUpdate}
      onClick={onClick}
      overlay={
        <>
          {onDelete && (
            <Button
              variant="secondary"
              size="icon"
              className="absolute right-1.5 top-1.5 h-7 w-7 rounded-full bg-white/85 text-gray-900 opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover:opacity-100 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              disabled={disabled || deleting}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {deleting && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm dark:bg-black/60">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white">
                <Loader2 className="h-5 w-5 animate-spin" />
                Deleting…
              </div>
            </div>
          )}
          {extraOverlay}
        </>
      }
    />
  );
}
