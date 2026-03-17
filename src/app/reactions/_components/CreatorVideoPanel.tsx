'use client';

import { useRef } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface CreatorVideoPanelProps {
  s3Url: string;
  durationS?: number;
  onTimeUpdate?: (currentTime: number) => void;
}

function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function CreatorVideoPanel({ s3Url, durationS, onTimeUpdate }: CreatorVideoPanelProps) {
  const videoRef = useRef<HTMLVideoElement>(null);

  return (
    <Card className="group overflow-hidden shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20">
      <CardContent className="p-0">
        <div className="relative">
          <video
            ref={videoRef}
            src={s3Url}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            className="aspect-video w-full bg-black/5 object-cover"
            onTimeUpdate={(e) => onTimeUpdate?.(e.currentTarget.currentTime)}
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity group-hover:opacity-80" />
        </div>

        <div className="space-y-2 p-4">
          <div className="line-clamp-2 font-semibold leading-snug">Creator Video</div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Commentary</Badge>
            {durationS != null && (
              <span className="text-xs text-muted-foreground">{formatDuration(durationS)}</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
