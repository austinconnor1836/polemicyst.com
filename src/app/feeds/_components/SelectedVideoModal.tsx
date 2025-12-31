'use client';

import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import ViralitySettings from '@/components/ViralitySettings';
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
import { getFeedVideoThumbnail } from '@/app/feeds/util/thumbnails';
import type { LLMProvider, ViralitySettingsValue } from '@shared/virality';

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
  defaultLLMProvider?: LLMProvider;
  onPersistDefaultLLM?: (provider: LLMProvider) => Promise<void> | void;
  isPersistingDefaultLLM?: boolean;
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
  defaultLLMProvider = 'gemini',
  onPersistDefaultLLM,
  isPersistingDefaultLLM = false,
}: SelectedVideoModalProps) {
  if (!video) return null;

  const { thumbnailUrl, youtubeId } = getFeedVideoThumbnail(video);
  const isYouTube = Boolean(youtubeId);
  const addedTime = video.createdAt ? formatRelativeTime(video.createdAt) : null;
  const isPendingDownload = video.status === 'pending';

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
              {thumbnailUrl ? (
                <img
                  src={thumbnailUrl}
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
              poster={thumbnailUrl || undefined}
              className="max-h-[35vh] w-full rounded object-contain"
            />
          )}

          <AspectRatioSelect value={aspectRatio} onChange={onAspectRatioChange} />
          <ViralitySettings
            value={viralitySettings}
            onChange={onViralitySettingsChange}
            defaultLLMProvider={defaultLLMProvider}
            onPersistLLMProvider={onPersistDefaultLLM}
            isPersistingLLMProvider={isPersistingDefaultLLM}
          />
        </div>

        <DialogFooter className="gap-2 pt-4 sm:gap-2">
          <Button onClick={onGenerateClip} disabled={isGeneratingClip || isPendingDownload}>
            {isPendingDownload
              ? 'Download in progress'
              : isGeneratingClip
                ? 'Generating...'
                : 'Generate clip'}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
