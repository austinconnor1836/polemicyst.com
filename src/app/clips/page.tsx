'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Copy,
  Download,
  ExternalLink,
  Loader2,
  Play,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react';

function formatRelativeTime(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  if (absSeconds < 60) return rtf.format(seconds, 'second');
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, 'hour');
  const days = Math.round(hours / 24);
  return rtf.format(days, 'day');
}

function formatJobState(state: string) {
  switch (state) {
    case 'active':
      return 'Generating clips now';
    case 'waiting':
      return 'Queued for processing';
    case 'delayed':
      return 'Retry scheduled';
    default:
      return 'Status unknown';
  }
}

type ClipVideo = {
  id: string;
  s3Url?: string | null;
  s3Key?: string | null;
  videoTitle?: string | null;
  sharedDescription?: string | null;
  transcript?: string | null;
  createdAt?: string;
  sourceVideoId?: string | null;
  sourceVideo?: { id: string; videoTitle?: string | null; s3Url?: string | null } | null;
};

type ClipJob = {
  jobId: string | number;
  feedVideoId: string;
  state: string;
  enqueuedAt: number | null;
  startedAt: number | null;
  feedName: string | null;
  title: string;
  clipSourceVideoId: string | null;
};

export default function ClipsPage() {
  const [clips, setClips] = useState<ClipVideo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [clipJobs, setClipJobs] = useState<ClipJob[]>([]);
  const [isLoadingJobs, setIsLoadingJobs] = useState(false);

  const [query, setQuery] = useState('');
  const [selectedClip, setSelectedClip] = useState<ClipVideo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const [copiedClipId, setCopiedClipId] = useState<string | null>(null);

  const fetchClips = useCallback(async () => {
    setIsLoading(true);
    setPageError(null);
    try {
      const res = await fetch('/api/clips');
      if (!res.ok) throw new Error('Failed to load clips');
      const data = (await res.json()) as ClipVideo[];
      setClips(data);
    } catch (err) {
      console.error(err);
      setPageError('Couldn’t load clips. Try refreshing.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  const fetchClipJobs = useCallback(async () => {
    setIsLoadingJobs(true);
    try {
      const res = await fetch('/api/clip-jobs');
      if (!res.ok) throw new Error('Failed to load clip jobs');
      const data = (await res.json()) as ClipJob[];
      setClipJobs(data);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoadingJobs(false);
    }
  }, []);

  const deleteClip = async (clip: ClipVideo) => {
    if (!confirm(`Delete clip "${clip.videoTitle || 'Untitled clip'}"?`)) return;
    setDeletingClipId(clip.id);
    setPageError(null);
    try {
      const res = await fetch(`/api/clips/${clip.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete clip');
      setClips((prev) => prev.filter((c) => c.id !== clip.id));
      if (selectedClip?.id === clip.id) setIsModalOpen(false);
    } catch (err) {
      console.error(err);
      setPageError('Failed to delete clip. Try again.');
    } finally {
      setDeletingClipId(null);
    }
  };

  const copyClipLink = async (clip: ClipVideo) => {
    if (!clip.s3Url) return;
    try {
      await navigator.clipboard.writeText(clip.s3Url);
      setCopiedClipId(clip.id);
      window.setTimeout(() => setCopiedClipId((cur) => (cur === clip.id ? null : cur)), 1200);
    } catch (err) {
      console.error(err);
      alert('Failed to copy link');
    }
  };

  useEffect(() => {
    fetchClips();
  }, [fetchClips]);

  useEffect(() => {
    fetchClipJobs();
    const interval = window.setInterval(fetchClipJobs, 15000);
    return () => window.clearInterval(interval);
  }, [fetchClipJobs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return clips;
    return clips.filter((c) => {
      const title = (c.videoTitle || '').toLowerCase();
      const desc = (c.sharedDescription || '').toLowerCase();
      const sourceTitle = (c.sourceVideo?.videoTitle || '').toLowerCase();
      return title.includes(q) || desc.includes(q) || sourceTitle.includes(q);
    });
  }, [clips, query]);

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-6">
        <div className="rounded-2xl border bg-gradient-to-b from-background to-background/60 p-6 sm:p-8">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight">Clips</h1>
              <div className="mt-1 text-sm text-muted-foreground">
                Browse your generated clips. Open any clip to preview, download, or delete.
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{filtered.length} shown</Badge>
              <Badge variant="outline">{clips.length} total</Badge>
            </div>
          </div>

          <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles, descriptions, or source…"
                className="pl-9 pr-9"
              />
              {query.trim().length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setQuery('')}
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <Button
              variant="outline"
              onClick={fetchClips}
              disabled={isLoading}
              className="shrink-0"
              title="Refresh clips"
            >
              <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
              Refresh
            </Button>
          </div>
        </div>
      </div>

      {clipJobs.length > 0 && (
        <div className="mb-6">
          <Card className="border-dashed border-muted/70 bg-muted/20 shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <Loader2
                  className={cn(
                    'h-4 w-4',
                    isLoadingJobs ? 'animate-spin' : 'text-muted-foreground'
                  )}
                />
                Clip generation in progress
              </CardTitle>
              <CardDescription>
                These videos are currently being scored. Click to view their status and finished
                clips.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {clipJobs.map((job) => (
                  <Card key={job.feedVideoId} className="border shadow-sm">
                    <CardContent className="flex flex-col gap-3 p-4">
                      <div>
                        <div className="text-sm font-semibold leading-snug line-clamp-2">
                          {job.title}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {job.feedName ? `${job.feedName} • ` : null}
                          {formatJobState(job.state)}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          {job.state === 'active' ? 'Generating' : 'Queued'}
                        </div>
                        {job.enqueuedAt ? (
                          <span>
                            since{' '}
                            {new Date(job.enqueuedAt).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        ) : null}
                      </div>
                      <Button asChild size="sm">
                        <Link href={`/clips/${job.feedVideoId}`}>View details</Link>
                      </Button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {pageError && (
        <div className="mb-6">
          <Card className="border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="flex flex-col gap-3 p-4 text-sm text-red-800 dark:text-red-200 sm:flex-row sm:items-center sm:justify-between">
              <div>{pageError}</div>
              <Button
                variant="secondary"
                onClick={fetchClips}
                disabled={isLoading}
                className="w-fit"
              >
                <RefreshCw className={cn('mr-2 h-4 w-4', isLoading && 'animate-spin')} />
                Retry
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {isLoading ? (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 9 }).map((_, idx) => (
            <Card key={idx} className="overflow-hidden">
              <CardContent className="p-0">
                <div className="aspect-video w-full animate-pulse bg-gray-100 dark:bg-zinc-900/40" />
                <div className="space-y-2 p-4">
                  <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-zinc-900/40" />
                  <div className="h-3 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-zinc-900/40" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : clips.length === 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">No clips yet</CardTitle>
            <CardDescription>
              Generate clips from a feed video and they’ll show up here.
            </CardDescription>
          </CardHeader>
          <CardContent className="pt-0">
            <Button asChild variant="secondary">
              <a href="/feeds">Go to feeds</a>
            </Button>
          </CardContent>
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">No matches</CardTitle>
            <CardDescription>Try a different search.</CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {filtered.map((clip) => (
            <Card
              key={clip.id}
              className="group cursor-pointer overflow-hidden shadow-sm transition-shadow hover:shadow-md"
              onClick={() => {
                setSelectedClip(clip);
                setIsModalOpen(true);
              }}
            >
              <CardContent className="p-0">
                <div className="relative">
                  <video
                    src={clip.s3Url || undefined}
                    preload="metadata"
                    muted
                    playsInline
                    tabIndex={-1}
                    className="aspect-video w-full bg-black/5 object-cover"
                  />
                  <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity group-hover:opacity-80" />

                  <div className="pointer-events-none absolute bottom-2 left-2 flex items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
                    <div className="flex items-center gap-1.5 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                      <Play className="h-3.5 w-3.5" />
                      Preview
                    </div>
                    {!clip.videoTitle?.trim() ? (
                      <div className="rounded-full bg-white/10 px-2 py-1 text-[11px] text-white backdrop-blur">
                        Metadata pending
                      </div>
                    ) : null}
                  </div>

                  <Button
                    variant="secondary"
                    size="icon"
                    className="absolute right-2 top-2 h-8 w-8 rounded-full bg-white/85 text-gray-900 opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover:opacity-100 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteClip(clip);
                    }}
                    disabled={deletingClipId === clip.id}
                    title="Delete clip"
                  >
                    <Trash2
                      className={cn('h-4 w-4', deletingClipId === clip.id && 'animate-pulse')}
                    />
                  </Button>
                </div>

                <div className="space-y-2 p-4">
                  <div className="line-clamp-2 font-semibold leading-snug">
                    {clip.videoTitle?.trim()
                      ? clip.videoTitle
                      : clip.sourceVideo?.videoTitle
                        ? `Clip from ${clip.sourceVideo.videoTitle}`
                        : 'Untitled clip'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="outline">Clip</Badge>
                    {!clip.sourceVideoId ? <Badge variant="outline">Legacy</Badge> : null}
                    {clip.createdAt ? (
                      <span className="text-xs text-muted-foreground">
                        {formatRelativeTime(clip.createdAt)}
                      </span>
                    ) : null}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {selectedClip && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="leading-snug">
                {selectedClip.videoTitle?.trim()
                  ? selectedClip.videoTitle
                  : selectedClip.sourceVideo?.videoTitle
                    ? `Clip from ${selectedClip.sourceVideo.videoTitle}`
                    : 'Untitled clip'}
              </DialogTitle>
              <DialogDescription>Preview your clip and manage it.</DialogDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant="outline">Clip</Badge>
                {!selectedClip.sourceVideoId ? <Badge variant="outline">Legacy</Badge> : null}
                {selectedClip.sourceVideo?.videoTitle ? (
                  <Badge variant="secondary">From: {selectedClip.sourceVideo.videoTitle}</Badge>
                ) : null}
                {selectedClip.createdAt ? (
                  <Badge variant="outline">
                    Created {formatRelativeTime(selectedClip.createdAt)}
                  </Badge>
                ) : null}
              </div>
            </DialogHeader>

            <div className="space-y-4">
              <video
                src={selectedClip.s3Url || undefined}
                controls
                preload="metadata"
                playsInline
                className="max-h-[45vh] w-full rounded object-contain"
              />

              {selectedClip.sharedDescription?.trim() ? (
                <Card>
                  <CardHeader className="pb-3">
                    <CardTitle className="text-base">Description</CardTitle>
                    <CardDescription>Generated metadata (if available).</CardDescription>
                  </CardHeader>
                  <CardContent className="text-sm whitespace-pre-wrap">
                    {selectedClip.sharedDescription}
                  </CardContent>
                </Card>
              ) : null}
            </div>

            <DialogFooter className="gap-2 sm:gap-2">
              {selectedClip.s3Url ? (
                <>
                  <Button asChild variant="secondary">
                    <a href={selectedClip.s3Url} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open
                    </a>
                  </Button>
                  <Button asChild variant="outline">
                    <a href={selectedClip.s3Url} download>
                      <Download className="mr-2 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      await copyClipLink(selectedClip);
                    }}
                    title="Copy clip URL"
                  >
                    <Copy className="mr-2 h-4 w-4" />
                    {copiedClipId === selectedClip.id ? 'Copied' : 'Copy link'}
                  </Button>
                </>
              ) : null}
              {selectedClip.sourceVideo?.s3Url ? (
                <Button asChild variant="outline">
                  <a href={selectedClip.sourceVideo.s3Url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open source
                  </a>
                </Button>
              ) : null}
              <Button
                variant="destructive"
                onClick={async () => {
                  await deleteClip(selectedClip);
                }}
                disabled={deletingClipId === selectedClip.id}
              >
                {deletingClipId === selectedClip.id ? 'Deleting...' : 'Delete clip'}
              </Button>
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
