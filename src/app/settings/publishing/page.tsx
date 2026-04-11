'use client';

import { useEffect, useState } from 'react';
import { signIn } from 'next-auth/react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Link2, CheckCircle2, AlertCircle, Loader2, Video, Type, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';

interface PublishingPlatform {
  platform: string;
  displayName: string;
  description: string;
  provider: string;
  brandColor: string;
  capabilities: Array<{ label: string; icon: 'video' | 'text' }>;
  docsUrl?: string;
}

/**
 * Canonical list of publishing destinations. Display order + metadata for the
 * dedicated Publishing Destinations settings page. Kept here (not fetched from
 * the API) so the page renders instantly; connection status is fetched separately.
 */
const PLATFORMS: PublishingPlatform[] = [
  {
    platform: 'youtube',
    displayName: 'YouTube',
    description: 'Upload full-length videos and Shorts. Custom thumbnails supported.',
    provider: 'google',
    brandColor: '#FF0000',
    capabilities: [
      { label: 'Video upload', icon: 'video' },
      { label: 'Shorts', icon: 'video' },
    ],
    docsUrl: 'https://www.youtube.com/creators/',
  },
  {
    platform: 'facebook',
    displayName: 'Facebook',
    description: 'Post videos and text updates to your Facebook Page feed.',
    provider: 'facebook',
    brandColor: '#1877F2',
    capabilities: [
      { label: 'Video upload', icon: 'video' },
      { label: 'Text post', icon: 'text' },
    ],
  },
  {
    platform: 'instagram',
    displayName: 'Instagram Reels',
    description: 'Publish vertical videos as Reels to your Instagram account.',
    provider: 'facebook',
    brandColor: '#E4405F',
    capabilities: [{ label: 'Reels', icon: 'video' }],
  },
  {
    platform: 'twitter',
    displayName: 'X / Twitter',
    description: 'Post videos and tweets to your X timeline.',
    provider: 'twitter',
    brandColor: '#000000',
    capabilities: [
      { label: 'Video upload', icon: 'video' },
      { label: 'Tweet', icon: 'text' },
    ],
  },
  {
    platform: 'bluesky',
    displayName: 'Bluesky',
    description: 'Post text updates to Bluesky. Video support coming soon.',
    provider: 'bluesky',
    brandColor: '#0085FF',
    capabilities: [{ label: 'Text post', icon: 'text' }],
  },
  {
    platform: 'threads',
    displayName: 'Threads',
    description: 'Post text updates to Threads by Meta.',
    provider: 'facebook',
    brandColor: '#000000',
    capabilities: [{ label: 'Text post', icon: 'text' }],
  },
];

interface PlatformStatus {
  platform: string;
  connected: boolean;
}

export default function PublishingDestinationsPage() {
  const [statuses, setStatuses] = useState<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const loadStatus = async () => {
      try {
        // Use the same endpoint the publish modal uses — it already knows how
        // to map OAuth providers to platforms.
        const res = await fetch('/api/publish/platform-status');
        if (!res.ok) throw new Error('Failed to load');
        const data = await res.json();
        const map = new Map<string, boolean>();
        for (const s of data.platforms as PlatformStatus[]) {
          map.set(s.platform, s.connected);
        }
        setStatuses(map);
      } catch {
        toast.error('Failed to load connection status');
      } finally {
        setLoading(false);
      }
    };
    loadStatus();
  }, []);

  const connectedCount = Array.from(statuses.values()).filter(Boolean).length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">Publishing Destinations</h1>
        <p className="text-muted-foreground">
          Connect the social accounts you want to publish your reaction videos to.
        </p>
        {!loading && (
          <div className="flex items-center gap-2 pt-1">
            <Badge
              className={
                connectedCount > 0
                  ? 'bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300'
                  : 'bg-muted text-muted-foreground'
              }
            >
              {connectedCount} of {PLATFORMS.length} connected
            </Badge>
          </div>
        )}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          {connectedCount === 0 && (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-8 text-center">
                <AlertCircle className="h-8 w-8 text-amber-500" />
                <div>
                  <p className="font-medium">No platforms connected yet</p>
                  <p className="text-sm text-muted-foreground">
                    Connect at least one platform below to start publishing your videos.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PLATFORMS.map((p) => {
              const connected = statuses.get(p.platform) ?? false;
              return (
                <Card key={p.platform} className="relative overflow-hidden">
                  {/* Brand accent stripe */}
                  <div
                    className="absolute inset-x-0 top-0 h-1"
                    style={{ backgroundColor: p.brandColor }}
                    aria-hidden="true"
                  />
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2">
                          <CardTitle className="text-base">{p.displayName}</CardTitle>
                          {connected ? (
                            <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
                              <CheckCircle2 className="mr-1 h-3 w-3" />
                              Connected
                            </Badge>
                          ) : (
                            <Badge variant="outline" className="text-muted-foreground">
                              Not connected
                            </Badge>
                          )}
                        </div>
                        <CardDescription className="text-xs">{p.description}</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      {p.capabilities.map((cap) => (
                        <Badge
                          key={cap.label}
                          variant="secondary"
                          className="gap-1 text-[10px] font-normal"
                        >
                          {cap.icon === 'video' ? (
                            <Video className="h-2.5 w-2.5" />
                          ) : (
                            <Type className="h-2.5 w-2.5" />
                          )}
                          {cap.label}
                        </Badge>
                      ))}
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <Button
                        variant={connected ? 'outline' : 'default'}
                        size="sm"
                        className="gap-1.5"
                        onClick={() => signIn(p.provider, { callbackUrl: '/settings/publishing' })}
                      >
                        <Link2 className="h-3.5 w-3.5" />
                        {connected ? 'Reconnect' : 'Connect'}
                      </Button>
                      {p.docsUrl && (
                        <a
                          href={p.docsUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        >
                          Learn more
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
