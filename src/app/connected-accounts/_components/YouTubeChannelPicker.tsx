'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Loader2, RefreshCw } from 'lucide-react';
import type { YouTubeChannel } from '@/app/connected-accounts/types';
import { cn } from '@/lib/utils';

interface YouTubeChannelPickerProps {
  onSelectChannel: (channel: YouTubeChannel) => void;
}

export function YouTubeChannelPicker({ onSelectChannel }: YouTubeChannelPickerProps) {
  const [channels, setChannels] = useState<YouTubeChannel[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchChannels = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/youtube/channels');
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (data.error === 'google_not_connected' || data.error === 'insufficient_scope') {
          setError(data.message || 'Please re-authenticate with Google');
        } else {
          setError('Failed to load channels');
        }
        return;
      }
      const data = await res.json();
      setChannels(data);
    } catch {
      setError('Failed to load channels');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 rounded-lg border p-3">
            <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
            <div className="flex-1 space-y-2">
              <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
              <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={fetchChannels}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Retry
          </Button>
        </div>
      </div>
    );
  }

  if (channels.length === 0) {
    return (
      <div className="space-y-4">
        <div className="rounded-lg border border-dashed p-6 text-center">
          <p className="text-sm text-muted-foreground">
            No YouTube channels found on this account.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        {channels.map((channel) => (
          <Card
            key={channel.id}
            className={cn(
              'flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/5 hover:border-accent'
            )}
            onClick={() => onSelectChannel(channel)}
          >
            {channel.thumbnail ? (
              <img
                src={channel.thumbnail}
                alt={channel.title}
                className="h-10 w-10 rounded-full object-cover"
              />
            ) : (
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-muted text-sm font-medium">
                {channel.title.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{channel.title}</div>
              {channel.subscriberCount && (
                <div className="text-xs text-muted-foreground">
                  {formatSubscriberCount(channel.subscriberCount)} subscribers
                </div>
              )}
            </div>
            <Button variant="secondary" size="sm">
              Connect
            </Button>
          </Card>
        ))}
      </div>
    </div>
  );
}

function formatSubscriberCount(count: string): string {
  const num = parseInt(count, 10);
  if (isNaN(num)) return count;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return count;
}
