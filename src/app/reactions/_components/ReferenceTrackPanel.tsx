'use client';

import { Button } from '@/components/ui/button';
import { VideoCard } from '@/components/ui/video-card';
import { Badge } from '@/components/ui/badge';
import { Loader2, Trash2 } from 'lucide-react';

interface Track {
  id: string;
  label?: string | null;
  s3Url: string;
  durationS: number;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
  hasAudio: boolean;
}

interface ReferenceTrackPanelProps {
  track: Track;
  index: number;
  mode: 'pre-synced' | 'timeline';
  onUpdate: (trackId: string, data: Partial<Track>) => void;
  onRemove: (trackId: string) => void;
  disabled?: boolean;
  deleting?: boolean;
  onClick?: () => void;
}

export function ReferenceTrackPanel({
  track,
  index,
  onRemove,
  disabled,
  deleting,
  onClick,
}: ReferenceTrackPanelProps) {
  const effectiveDuration = (track.trimEndS ?? track.durationS) - track.trimStartS;

  return (
    <VideoCard
      size="md"
      src={track.s3Url}
      label={track.label || `Reference ${index + 1}`}
      badge={
        <Badge variant="secondary" className="text-[11px] shrink-0">
          {effectiveDuration.toFixed(1)}s
        </Badge>
      }
      sublabel={!track.hasAudio ? 'No audio' : undefined}
      onClick={onClick}
      overlay={
        <>
          <Button
            variant="secondary"
            size="icon"
            className="absolute right-1.5 top-1.5 h-7 w-7 rounded-full bg-white/85 text-gray-900 opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover:opacity-100 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={(e) => {
              e.stopPropagation();
              onRemove(track.id);
            }}
            disabled={disabled || deleting}
            title="Remove track"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
          {deleting && (
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
