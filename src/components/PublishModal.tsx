'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { VideoCard } from '@/components/ui/video-card';
import { Loader2, CheckCircle2, XCircle, ExternalLink, Link2 } from 'lucide-react';
import toast from 'react-hot-toast';

interface PlatformInfo {
  platform: string;
  displayName: string;
  connected: boolean;
  supportsText: boolean;
}

interface PublishResult {
  platform: string;
  status: 'pending' | 'published' | 'failed';
  platformUrl?: string | null;
  publishError?: string | null;
}

interface MediaItem {
  url: string;
  label?: string;
}

export interface PublishModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultContent?: string;
  /** Single media URL (convenience shorthand) */
  mediaUrl?: string;
  /** Single media label (convenience shorthand) */
  mediaLabel?: string;
  /** Multiple media items — takes precedence over mediaUrl/mediaLabel when provided */
  mediaItems?: MediaItem[];
}

const CHAR_LIMITS: Record<string, number> = {
  twitter: 280,
  bluesky: 300,
};

type Phase = 'compose' | 'publishing' | 'results';

export function PublishModal({
  open,
  onOpenChange,
  defaultContent = '',
  mediaUrl,
  mediaLabel,
  mediaItems,
}: PublishModalProps) {
  // Normalize to a single list of media items
  const resolvedMedia: MediaItem[] =
    mediaItems && mediaItems.length > 0
      ? mediaItems
      : mediaUrl
        ? [{ url: mediaUrl, label: mediaLabel }]
        : [];
  const [content, setContent] = useState('');
  const [platforms, setPlatforms] = useState<PlatformInfo[]>([]);
  const [defaults, setDefaults] = useState<string[]>([]);
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set());
  const [phase, setPhase] = useState<Phase>('compose');
  const [results, setResults] = useState<PublishResult[]>([]);
  const [loadingPlatforms, setLoadingPlatforms] = useState(false);

  // Build initial content when modal opens
  useEffect(() => {
    if (open) {
      const urls = resolvedMedia.map((m) => m.url);
      const parts = [defaultContent, ...urls].filter(Boolean);
      setContent(parts.join('\n\n'));
      setPhase('compose');
      setResults([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Fetch platforms when modal opens
  useEffect(() => {
    if (!open) return;
    let cancelled = false;

    const fetchPlatforms = async () => {
      setLoadingPlatforms(true);
      try {
        const res = await fetch('/api/social-posts/platforms');
        if (!res.ok) throw new Error('Failed to load platforms');
        const data = await res.json();
        if (cancelled) return;
        setPlatforms(data.platforms ?? []);
        setDefaults(data.defaults ?? []);

        // Pre-select connected defaults
        const connected = (data.platforms as PlatformInfo[])
          .filter((p) => p.connected)
          .map((p) => p.platform);
        const preselected = (data.defaults as string[]).filter((d) => connected.includes(d));
        setSelectedPlatforms(new Set(preselected.length > 0 ? preselected : connected));
      } catch {
        toast.error('Failed to load publishing platforms');
      } finally {
        if (!cancelled) setLoadingPlatforms(false);
      }
    };

    fetchPlatforms();
    return () => {
      cancelled = true;
    };
  }, [open]);

  const togglePlatform = useCallback((platform: string) => {
    setSelectedPlatforms((prev) => {
      const next = new Set(prev);
      if (next.has(platform)) next.delete(platform);
      else next.add(platform);
      return next;
    });
  }, []);

  const connectedSelected = platforms.filter(
    (p) => p.connected && selectedPlatforms.has(p.platform)
  );

  // Character limit checks
  const charWarnings = connectedSelected
    .filter((p) => {
      const limit = CHAR_LIMITS[p.platform];
      return limit && content.length > limit;
    })
    .map((p) => ({
      platform: p.displayName,
      limit: CHAR_LIMITS[p.platform],
    }));

  const lowestLimit = connectedSelected.reduce<number | null>((min, p) => {
    const limit = CHAR_LIMITS[p.platform];
    if (!limit) return min;
    return min === null ? limit : Math.min(min, limit);
  }, null);

  const canPublish =
    content.trim().length > 0 && connectedSelected.length > 0 && phase === 'compose';

  const handlePublish = async () => {
    setPhase('publishing');
    setResults(
      connectedSelected.map((p) => ({
        platform: p.platform,
        status: 'pending',
      }))
    );

    try {
      const res = await fetch('/api/social-posts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: content.trim(),
          platforms: connectedSelected.map((p) => p.platform),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        toast.error(data.error || 'Publish failed');
        setPhase('compose');
        return;
      }

      const post = await res.json();
      const publishResults: PublishResult[] = (post.publishes ?? []).map(
        (pub: {
          platform: string;
          status: string;
          platformUrl?: string | null;
          publishError?: string | null;
        }) => ({
          platform: pub.platform,
          status: pub.status,
          platformUrl: pub.platformUrl,
          publishError: pub.publishError,
        })
      );

      setResults(publishResults);
      setPhase('results');

      const allSuccess = publishResults.every((r) => r.status === 'published');
      const anySuccess = publishResults.some((r) => r.status === 'published');
      if (allSuccess) {
        toast.success('Published to all platforms!');
      } else if (anySuccess) {
        toast.success('Published to some platforms (see details)');
      } else {
        toast.error('Publishing failed');
      }
    } catch {
      toast.error('Network error while publishing');
      setPhase('compose');
    }
  };

  const platformDisplayName = (platform: string) =>
    platforms.find((p) => p.platform === platform)?.displayName ?? platform;

  return (
    <Dialog open={open} onOpenChange={phase === 'publishing' ? undefined : onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Publish</DialogTitle>
          <DialogDescription className="sr-only">
            Share content to your connected social accounts
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Phase: Compose */}
          {phase === 'compose' && (
            <>
              <div className="space-y-2">
                <Textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  placeholder="Write your post..."
                  rows={4}
                />
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <span>
                    {content.length}
                    {lowestLimit ? ` / ${lowestLimit}` : ''} characters
                  </span>
                  {charWarnings.length > 0 && (
                    <span className="text-amber-600 dark:text-amber-400">
                      Exceeds limit for {charWarnings.map((w) => w.platform).join(', ')}
                    </span>
                  )}
                </div>
              </div>

              {/* Media preview(s) */}
              {resolvedMedia.length > 1 ? (
                <div className="grid grid-cols-2 gap-3">
                  {resolvedMedia.map((item, i) => (
                    <VideoCard
                      key={i}
                      size="sm"
                      src={item.url}
                      label={item.label || `Video ${i + 1}`}
                      controls
                      className="max-w-none"
                    />
                  ))}
                </div>
              ) : resolvedMedia.length === 1 ? (
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted/50 px-3 py-2 text-sm">
                  <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-foreground">{resolvedMedia[0].url}</p>
                    {resolvedMedia[0].label && (
                      <p className="text-xs text-muted-foreground">{resolvedMedia[0].label}</p>
                    )}
                  </div>
                </div>
              ) : null}

              {/* Platform toggles */}
              <div className="space-y-2">
                <p className="text-sm font-medium">Platforms</p>
                {loadingPlatforms ? (
                  <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Loading platforms...
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {platforms.map((p) => (
                      <button
                        key={p.platform}
                        type="button"
                        disabled={!p.connected}
                        onClick={() => togglePlatform(p.platform)}
                        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          !p.connected
                            ? 'cursor-not-allowed border-border text-muted-foreground opacity-50'
                            : selectedPlatforms.has(p.platform)
                              ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
                              : 'border-border text-foreground hover:bg-muted'
                        }`}
                      >
                        {p.displayName}
                        {!p.connected && (
                          <span className="text-xs text-muted-foreground">(not connected)</span>
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {/* Phase: Publishing */}
          {phase === 'publishing' && (
            <div className="space-y-3 py-4">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center gap-3 text-sm">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  <span>Publishing to {platformDisplayName(r.platform)}...</span>
                </div>
              ))}
            </div>
          )}

          {/* Phase: Results */}
          {phase === 'results' && (
            <div className="space-y-3 py-2">
              {results.map((r) => (
                <div key={r.platform} className="flex items-center justify-between gap-3 text-sm">
                  <div className="flex items-center gap-2">
                    {r.status === 'published' ? (
                      <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                    ) : (
                      <XCircle className="h-4 w-4 text-red-600 dark:text-red-400" />
                    )}
                    <span>{platformDisplayName(r.platform)}</span>
                  </div>
                  {r.status === 'published' && r.platformUrl ? (
                    <a
                      href={r.platformUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline dark:text-blue-400"
                    >
                      View post <ExternalLink className="h-3 w-3" />
                    </a>
                  ) : r.status === 'failed' ? (
                    <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                      {r.publishError || 'Failed'}
                    </Badge>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>

        <DialogFooter className="pt-4 gap-2 sm:gap-2">
          {phase === 'compose' && (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button onClick={handlePublish} disabled={!canPublish}>
                Publish
              </Button>
            </>
          )}
          {phase === 'results' && <Button onClick={() => onOpenChange(false)}>Done</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
