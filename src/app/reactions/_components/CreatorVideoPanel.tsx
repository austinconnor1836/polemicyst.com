'use client';

import { useRef } from 'react';
import { VideoCard } from '@/components/ui/video-card';
import { Badge } from '@/components/ui/badge';

interface CreatorVideoPanelProps {
  s3Url: string;
  durationS?: number;
  onTimeUpdate?: (currentTime: number) => void;
  onClick?: () => void;
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
    />
  );
}
