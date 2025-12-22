'use client';

import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import ViralitySettings, { type ViralitySettingsValue } from '@/components/ViralitySettings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { FeedVideo } from '@/app/feeds/types';
import { formatRelativeTime } from '@/app/feeds/util/time';

export type SelectedVideoModalProps = {
  video: FeedVideo | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  aspectRatio: AspectRatio;
  onAspectRatioChange: (value: AspectRatio) => void;
  viralitySettings: ViralitySettingsValue;
  onViralitySettingsChange: (value: ViralitySettingsValue) => void;
  onGenerateClip: () => Promise<void>;
  isGeneratingClip: boolean;
};

export default function SelectedVideoModal({
  video,
  open,
  onOpenChange,
  aspectRatio,
  onAspectRatioChange,
  viralitySettings,
  onViralitySettingsChange,
  onGenerateClip,
  isGeneratingClip,
}: SelectedVideoModalProps) {
  if (!video) return null;

  const isYouTube = video.s3Url.includes('youtube.com') || video.s3Url.includes('youtu.be');
  const thumb =
    video.thumbnailUrl ||
    (isYouTube
      ? `https://img.youtube.com/vi/${video.s3Url.match(/[?&]v=([^&]+)/)?.[1]}/hqdefault.jpg`
      : null);
  const addedTime = video.createdAt ? formatRelativeTime(video.createdAt) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="leading-snug">{video.title}</DialogTitle>
          <DialogDescription>Configure clip generation settings.</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2 py-1.5">
            {video.feed?.name ? (
              <Badge variant="secondary" className="my-1">
                {video.feed.name}
              </Badge>
            ) : null}
            {addedTime ? (
              <Badge variant="outline" className="my-1">
                Added {addedTime}
              </Badge>
            ) : null}
          </div>

          {isYouTube ? (
            <div className="flex aspect-video w-full flex-col items-center justify-center rounded bg-black/5 p-4">
              {thumb ? (
                <img
                  src={thumb}
                  alt={video.title}
                  className="max-h-[35vh] w-full rounded object-contain"
                />
              ) : (
                <div className="flex h-40 w-full items-center justify-center bg-gray-100 text-gray-400">
                  <span className="text-sm">No preview available</span>
                </div>
              )}
              <div className="mt-2 text-xs text-muted-foreground">
                Preview not available for YouTube sources. Using thumbnail.
              </div>
            </div>
          ) : (
            <video
              src={video.s3Url}
              controls
              preload="metadata"
              playsInline
              className="max-h-[35vh] w-full rounded object-contain"
            />
          )}

          <AspectRatioSelect value={aspectRatio} onChange={onAspectRatioChange} />
          <ViralitySettings value={viralitySettings} onChange={onViralitySettingsChange} />
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          <Button onClick={onGenerateClip} disabled={isGeneratingClip}>
            {isGeneratingClip ? 'Generating...' : 'Generate clip'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
