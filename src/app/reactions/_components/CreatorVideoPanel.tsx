'use client';

import { useRef } from 'react';
import { VideoCard } from '@/components/ui/video-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Trash2, Loader2 } from 'lucide-react';

interface CreatorVideoPanelProps {
  s3Url: string;
  durationS?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onClick?: () => void;
  deletingCreator?: boolean;
  onDelete?: () => void;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function CreatorVideoPanel({
  s3Url,
  durationS,
  onTimeUpdate,
  onClick,
  deletingCreator,
  onDelete,
}: CreatorVideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <VideoCard
      size="md"
      src={s3Url}
      label="Creator Video"
      badge={
        <Badge variant="secondary" className="text-[11px]">
          Commentary
        </Badge>
      }
      sublabel={durationS != null ? formatDuration(durationS) : undefined}
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
              disabled={deletingCreator}
              title="Remove creator video"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          )}
          {deletingCreator && (
            <div className="absolute inset-0 z-10 flex items-center justify-center rounded-md bg-background/80 backdrop-blur-sm dark:bg-black/60">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white">
                <Loader2 className="h-5 w-5 animate-spin" />
                Deleting…
              </div>
            </div>
          )}
        </>
      }
    />
  );
}
