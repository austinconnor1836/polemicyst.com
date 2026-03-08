'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import {
  Check,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Loader2,
  Send,
  Sparkles,
  X,
} from 'lucide-react';

type PlatformContent = {
  title?: string;
  description: string;
  hashtags: string;
};

type PlatformKey = 'youtube' | 'facebook' | 'instagram' | 'bluesky' | 'twitter';

type ComposeData = {
  clip: { id: string; title: string; s3Url?: string | null };
  aiGenerated: boolean;
  connected: Record<PlatformKey, boolean>;
  content: Record<PlatformKey, PlatformContent>;
};

type PublishResult = {
  success: boolean;
  url?: string;
  id?: string;
  error?: string;
};

const PLATFORM_META: Record<PlatformKey, { label: string; color: string; charLimit: number }> = {
  youtube: { label: 'YouTube', color: 'bg-red-500', charLimit: 5000 },
  facebook: { label: 'Facebook', color: 'bg-blue-600', charLimit: 5000 },
  instagram: {
    label: 'Instagram',
    color: 'bg-gradient-to-tr from-purple-600 to-pink-500',
    charLimit: 2200,
  },
  bluesky: { label: 'Bluesky', color: 'bg-sky-500', charLimit: 300 },
  twitter: { label: 'Twitter / X', color: 'bg-neutral-800 dark:bg-neutral-200', charLimit: 280 },
};

const ALL_PLATFORMS: PlatformKey[] = ['youtube', 'facebook', 'instagram', 'bluesky', 'twitter'];

export default function ComposePostDialog({
  clipId,
  open,
  onOpenChange,
}: {
  clipId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<ComposeData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [selected, setSelected] = useState<Record<PlatformKey, boolean>>({
    youtube: false,
    facebook: false,
    instagram: false,
    bluesky: false,
    twitter: false,
  });
  const [content, setContent] = useState<Record<PlatformKey, PlatformContent>>({
    youtube: { title: '', description: '', hashtags: '' },
    facebook: { description: '', hashtags: '' },
    instagram: { description: '', hashtags: '' },
    bluesky: { description: '', hashtags: '' },
    twitter: { description: '', hashtags: '' },
  });
  const [expandedPlatform, setExpandedPlatform] = useState<PlatformKey | null>('youtube');

  const [publishing, setPublishing] = useState(false);
  const [results, setResults] = useState<Record<string, PublishResult> | null>(null);

  const compose = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResults(null);
    try {
      const res = await fetch(`/api/clips/${clipId}/compose`, { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to compose (${res.status})`);
      }
      const json = (await res.json()) as ComposeData;
      setData(json);
      setContent(json.content);
      const sel: Record<PlatformKey, boolean> = {} as any;
      for (const p of ALL_PLATFORMS) {
        sel[p] = json.connected[p];
      }
      setSelected(sel);
      if (json.connected.youtube) setExpandedPlatform('youtube');
      else {
        const first = ALL_PLATFORMS.find((p) => json.connected[p]);
        setExpandedPlatform(first || 'youtube');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate post content');
    } finally {
      setLoading(false);
    }
  }, [clipId]);

  useEffect(() => {
    if (open && !data && !loading) {
      compose();
    }
  }, [open, data, loading, compose]);

  useEffect(() => {
    if (!open) {
      setData(null);
      setResults(null);
      setError(null);
    }
  }, [open]);

  const handlePublish = async () => {
    setPublishing(true);
    setResults(null);
    try {
      const platforms: Record<string, { title?: string; description: string }> = {};
      for (const p of ALL_PLATFORMS) {
        if (!selected[p]) continue;
        const c = content[p];
        const desc = c.hashtags ? `${c.description}\n\n${c.hashtags}` : c.description;
        platforms[p] = {
          ...(c.title ? { title: c.title } : {}),
          description: desc,
        };
      }

      const res = await fetch(`/api/clips/${clipId}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ platforms }),
      });
      const json = await res.json();
      setResults(json.results || {});
    } catch (err: any) {
      setResults({ _error: { success: false, error: err.message || 'Network error' } });
    } finally {
      setPublishing(false);
    }
  };

  const selectedCount = ALL_PLATFORMS.filter((p) => selected[p]).length;
  const hasResults = results && Object.keys(results).length > 0;
  const allSucceeded = hasResults && Object.values(results!).every((r) => r.success);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Compose &amp; Publish</DialogTitle>
          <DialogDescription>
            AI-generated post content for each platform. Edit and publish when ready.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              <p className="text-sm text-muted-foreground">Generating post content with AI...</p>
            </div>
          ) : error ? (
            <div className="space-y-3">
              <div className="rounded-lg border border-red-200 bg-red-50/70 px-4 py-3 text-sm text-red-800 dark:border-red-900/50 dark:bg-red-950/20 dark:text-red-200">
                {error}
              </div>
              <Button variant="secondary" size="sm" onClick={compose}>
                Retry
              </Button>
            </div>
          ) : data ? (
            <>
              {data.aiGenerated ? (
                <div className="flex items-center gap-2 rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs text-primary">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  Content generated with AI — edit before publishing.
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-xs text-muted-foreground">
                  <Sparkles className="h-3.5 w-3.5 shrink-0" />
                  Template-based content. Connect an LLM for AI generation.
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                {ALL_PLATFORMS.map((p) => {
                  const meta = PLATFORM_META[p];
                  const connected = data.connected[p];
                  return (
                    <button
                      key={p}
                      type="button"
                      disabled={!connected}
                      onClick={() => setSelected((prev) => ({ ...prev, [p]: !prev[p] }))}
                      className={cn(
                        'flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                        connected && selected[p]
                          ? 'border-foreground/30 bg-foreground/5'
                          : connected
                            ? 'border-border hover:border-foreground/20'
                            : 'cursor-not-allowed border-border/50 opacity-50'
                      )}
                    >
                      <span className={cn('inline-block h-2 w-2 rounded-full', meta.color)} />
                      {meta.label}
                      {!connected && (
                        <span className="text-[10px] text-muted-foreground">Not connected</span>
                      )}
                      {connected && selected[p] && <Check className="h-3 w-3" />}
                    </button>
                  );
                })}
              </div>

              <div className="space-y-2">
                {ALL_PLATFORMS.filter((p) => data.connected[p]).map((p) => {
                  const meta = PLATFORM_META[p];
                  const isExpanded = expandedPlatform === p;
                  const c = content[p];
                  const descLen = c.description.length + (c.hashtags ? c.hashtags.length + 2 : 0);
                  const overLimit = descLen > meta.charLimit;

                  return (
                    <div
                      key={p}
                      className={cn(
                        'rounded-lg border transition-colors',
                        selected[p] ? 'border-foreground/20' : 'border-border opacity-60'
                      )}
                    >
                      <button
                        type="button"
                        className="flex w-full items-center justify-between px-4 py-3 text-left"
                        onClick={() => setExpandedPlatform(isExpanded ? null : p)}
                      >
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selected[p]}
                            onCheckedChange={(checked) =>
                              setSelected((prev) => ({ ...prev, [p]: checked }))
                            }
                            onClick={(e) => e.stopPropagation()}
                          />
                          <span
                            className={cn('inline-block h-2.5 w-2.5 rounded-full', meta.color)}
                          />
                          <span className="text-sm font-medium">{meta.label}</span>
                          {overLimit && (
                            <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                              Over limit
                            </Badge>
                          )}
                          {results?.[p] && (
                            <Badge
                              variant={results[p].success ? 'default' : 'destructive'}
                              className="text-[10px] px-1.5 py-0"
                            >
                              {results[p].success ? 'Published' : 'Failed'}
                            </Badge>
                          )}
                        </div>
                        {isExpanded ? (
                          <ChevronUp className="h-4 w-4 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="space-y-3 border-t px-4 py-3">
                          {c.title !== undefined && (
                            <div className="space-y-1.5">
                              <Label className="text-xs">Title</Label>
                              <Input
                                value={c.title || ''}
                                onChange={(e) =>
                                  setContent((prev) => ({
                                    ...prev,
                                    [p]: { ...prev[p], title: e.target.value },
                                  }))
                                }
                                placeholder="Post title"
                                maxLength={100}
                              />
                            </div>
                          )}
                          <div className="space-y-1.5">
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Description</Label>
                              <span
                                className={cn(
                                  'text-[10px]',
                                  overLimit ? 'text-red-500' : 'text-muted-foreground'
                                )}
                              >
                                {descLen}/{meta.charLimit}
                              </span>
                            </div>
                            <Textarea
                              value={c.description}
                              onChange={(e) =>
                                setContent((prev) => ({
                                  ...prev,
                                  [p]: { ...prev[p], description: e.target.value },
                                }))
                              }
                              placeholder="Post description"
                              rows={3}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">Hashtags</Label>
                            <Input
                              value={c.hashtags}
                              onChange={(e) =>
                                setContent((prev) => ({
                                  ...prev,
                                  [p]: { ...prev[p], hashtags: e.target.value },
                                }))
                              }
                              placeholder="#trending #viral"
                            />
                          </div>
                          {results?.[p]?.success && results[p].url && (
                            <a
                              href={results[p].url}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                              <ExternalLink className="h-3 w-3" />
                              View published post
                            </a>
                          )}
                          {results?.[p] && !results[p].success && (
                            <p className="text-xs text-red-500">{results[p].error}</p>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {ALL_PLATFORMS.every((p) => !data.connected[p]) && (
                <div className="rounded-lg border border-yellow-200 bg-yellow-50/70 px-4 py-3 text-sm text-yellow-800 dark:border-yellow-900/50 dark:bg-yellow-950/20 dark:text-yellow-200">
                  No social accounts connected. Connect accounts in Settings to publish.
                </div>
              )}
            </>
          ) : null}
        </div>

        <DialogFooter className="pt-4">
          {data && (
            <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <Button
                variant="secondary"
                size="sm"
                onClick={compose}
                disabled={loading || publishing}
              >
                <Sparkles className="mr-2 h-3.5 w-3.5" />
                Regenerate
              </Button>
              <div className="flex items-center gap-2">
                {hasResults && allSucceeded && (
                  <span className="text-xs text-green-600 dark:text-green-400">
                    All posts published successfully
                  </span>
                )}
                <Button onClick={handlePublish} disabled={publishing || selectedCount === 0}>
                  {publishing ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="mr-2 h-4 w-4" />
                  )}
                  {publishing
                    ? 'Publishing...'
                    : `Publish to ${selectedCount} platform${selectedCount !== 1 ? 's' : ''}`}
                </Button>
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
