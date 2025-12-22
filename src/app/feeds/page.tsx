'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import ViralitySettings, {
  getStrictnessConfig,
  type ViralitySettingsValue,
} from '@/components/ViralitySettings';
import type { AspectRatio } from '@/components/AspectRatioSelect';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { FeedsHeroAnimation } from '@/app/feeds/_components/FeedsHeroAnimation';
import SelectedVideoModal from '@/app/feeds/_components/SelectedVideoModal';
import { FeedVideo, VideoFeed } from '@/app/feeds/types';
import { formatRelativeTime } from '@/app/feeds/util/time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Plus, RefreshCw, Search, Trash2, X, Upload, Settings, Loader2 } from 'lucide-react';
import { Toaster, toast } from 'react-hot-toast';

function youtubeHandleUrlFromName(name: string) {
  const trimmed = (name || '').trim();
  if (!trimmed) return '';

  // "Same thing the user is typing", but avoid obviously invalid handle chars like spaces.
  // Also accept users typing "@handle" or pasting a full youtube handle URL.
  const extracted =
    trimmed.match(/youtube\.com\/@([^/?#\s]+)/i)?.[1] ??
    trimmed.match(/^@([^/?#\s]+)/)?.[1] ??
    trimmed;

  const handle = extracted.replace(/\s+/g, '');
  return handle ? `https://www.youtube.com/@${handle}` : '';
}

export default function FeedsPage() {
  const videosHeaderRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [feeds, setFeeds] = useState<VideoFeed[]>([]);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [form, setForm] = useState({ name: '', sourceUrl: '', pollingInterval: 60 });

  const [isLoadingFeeds, setIsLoadingFeeds] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [isCreatingFeed, setIsCreatingFeed] = useState(false);
  const [isAddFeedOpen, setIsAddFeedOpen] = useState(false);
  const [isAddVideoOpen, setIsAddVideoOpen] = useState(false);
  const [activeVideoTab, setActiveVideoTab] = useState<'file' | 'url'>('file');
  const [importUrl, setImportUrl] = useState('');
  const [pendingImport, setPendingImport] = useState<{ url: string; startedAt: string } | null>(
    null
  );
  const [deletingFeedId, setDeletingFeedId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  // Upload state
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const [videoQuery, setVideoQuery] = useState('');
  const [videoFeedFilter, setVideoFeedFilter] = useState<string>('all');
  const [videoSort, setVideoSort] = useState<'newest' | 'oldest' | 'title'>('newest');

  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [selectedFeedSettings, setSelectedFeedSettings] = useState<VideoFeed | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isFeedSettingsOpen, setIsFeedSettingsOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [viralitySettings, setViralitySettings] = useState<ViralitySettingsValue>({
    scoringMode: 'hybrid',
    strictnessPreset: 'balanced',
    includeAudio: false,
    saferClips: true,
    targetPlatform: 'reels',
    contentStyle: 'auto',
    showAdvanced: false,
  });

  const fetchFeeds = async () => {
    setIsLoadingFeeds(true);
    setPageError(null);
    try {
      const res = await fetch('/api/feeds');
      if (!res.ok) throw new Error('Failed to load feeds');
      const data = await res.json();
      setFeeds(data);
    } catch (err) {
      console.error(err);
      setPageError('Couldn’t load feeds. Try refreshing.');
      toast.error('Couldn’t load feeds');
    } finally {
      setIsLoadingFeeds(false);
    }
  };

  const fetchVideos = async () => {
    setIsLoadingVideos(true);
    setPageError(null);
    try {
      const res = await fetch('/api/feedVideos');
      if (!res.ok) throw new Error('Failed to load videos');
      const data = await res.json();
      setVideos(data);
    } catch (err) {
      console.error(err);
      setPageError('Couldn’t load feed videos. Try refreshing.');
      toast.error('Couldn’t load feed videos');
    } finally {
      setIsLoadingVideos(false);
    }
  };

  const addFeed = async () => {
    setIsCreatingFeed(true);
    setPageError(null);
    try {
      const res = await fetch('/api/feeds', {
        method: 'POST',
        body: JSON.stringify(form),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to create feed');
      setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
      await fetchFeeds();
      toast.success('Feed added');
      setIsAddFeedOpen(false);
    } catch (err) {
      console.error(err);
      setPageError('Couldn’t add feed. Check the URL and try again.');
      toast.error('Couldn’t add feed');
    } finally {
      setIsCreatingFeed(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error('Please upload a video file');
      return;
    }

    setIsUploading(true);
    setUploadProgress(0);
    const toastId = toast.loading('Starting upload...');

    try {
      // 1. Get presigned URL
      const presignedRes = await fetch('/api/uploads/presigned', {
        method: 'POST',
        body: JSON.stringify({
          filename: file.name,
          contentType: file.type,
        }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!presignedRes.ok) throw new Error('Failed to get upload URL');
      const { url, key } = await presignedRes.json();

      // 2. Upload to S3 (XHR for progress)
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', url, true);
        xhr.setRequestHeader('Content-Type', file.type);

        xhr.upload.onprogress = (ev) => {
          if (ev.lengthComputable) {
            const percentComplete = (ev.loaded / ev.total) * 100;
            setUploadProgress(Math.round(percentComplete));
            if (percentComplete < 100) {
              toast.loading(`Uploading: ${Math.round(percentComplete)}%`, { id: toastId });
            }
          }
        };

        xhr.onload = () => {
          if (xhr.status === 200) resolve();
          else reject(new Error('Upload failed'));
        };

        xhr.onerror = () => reject(new Error('Network error'));
        xhr.send(file);
      });

      toast.loading('Registering video...', { id: toastId });

      // 3. Register upload
      const completeRes = await fetch('/api/uploads/complete', {
        method: 'POST',
        body: JSON.stringify({ key, filename: file.name }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!completeRes.ok) throw new Error('Failed to register upload');

      toast.success('Upload complete!', { id: toastId });

      // Refresh everything
      await Promise.all([fetchFeeds(), fetchVideos()]);

      // Switch filter to Manual Uploads slightly after to help user find it
      setTimeout(() => {
        setVideoFeedFilter('all');
      }, 500);
    } catch (err) {
      console.error(err);
      toast.error('Upload failed', { id: toastId });
    } finally {
      setIsUploading(false);
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!importUrl) return;

    setIsUploading(true);
    setPendingImport({ url: importUrl, startedAt: new Date().toISOString() });
    const toastId = toast.loading('Importing from URL...');

    try {
      const res = await fetch('/api/uploads/from-url', {
        method: 'POST',
        body: JSON.stringify({ url: importUrl }),
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to import');
      }

      toast.success('Imported successfully!', { id: toastId });
      await Promise.all([fetchFeeds(), fetchVideos()]);
      setImportUrl('');
      setIsAddVideoOpen(false);

      // Switch filter to Manual Uploads
      setTimeout(() => {
        setVideoFeedFilter('all');
      }, 500);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Import failed', { id: toastId });
    } finally {
      setIsUploading(false);
      setPendingImport(null);
    }
  };

  const triggerClip = async (video: any) => {
    try {
      const strictnessConfig = getStrictnessConfig(viralitySettings.strictnessPreset);
      const res = await fetch('/api/trigger-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          feedVideoId: video.id,
          userId: video.userId,
          aspectRatio: video.aspectRatio || '9:16',
          scoringMode: viralitySettings.scoringMode,
          includeAudio: viralitySettings.includeAudio,
          saferClips: viralitySettings.saferClips,
          targetPlatform: viralitySettings.targetPlatform,
          contentStyle: viralitySettings.contentStyle,
          ...strictnessConfig,
        }),
      });

      if (!res.ok) throw new Error('Failed to trigger clip');

      const data = await res.json();
      console.log('✅ Job enqueued:', data);
      toast.success('Clip job enqueued');
    } catch (err) {
      console.error(err);
      toast.error('Failed to trigger clip job');
    }
  };

  const handleGenerateClip = async () => {
    if (!selectedVideo) return;
    setIsGeneratingClip(true);
    try {
      await triggerClip({ ...selectedVideo, aspectRatio });
      setIsModalOpen(false);
    } finally {
      setIsGeneratingClip(false);
    }
  };

  const deleteFeed = async (feedId: string) => {
    if (!confirm('Delete this feed and all ingested videos?')) return;
    setDeletingFeedId(feedId);
    setPageError(null);
    try {
      const res = await fetch(`/api/feeds/${feedId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete feed');
      await Promise.all([fetchFeeds(), fetchVideos()]);
      toast.success('Feed deleted');
    } catch (err) {
      console.error(err);
      setPageError('Failed to delete feed. Try again.');
      toast.error('Failed to delete feed');
    } finally {
      setDeletingFeedId(null);
    }
  };

  const updateFeedSettings = async (feedId: string, updates: any) => {
    try {
      const res = await fetch(`/api/feeds/${feedId}`, {
        method: 'PATCH',
        body: JSON.stringify(updates),
        headers: { 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error('Failed to update feed');
      await fetchFeeds();
      toast.success('Settings saved');
      setIsFeedSettingsOpen(false);
    } catch (err) {
      console.error(err);
      toast.error('Failed to update settings');
    }
  };

  const deleteVideo = async (video: FeedVideo) => {
    if (!confirm(`Delete video '${video.title}'?`)) return;
    setDeletingVideoId(video.id);
    setPageError(null);
    try {
      const res = await fetch(`/api/feedVideos/${video.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete video');
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
      toast.success('Video deleted');
    } catch (err) {
      console.error(err);
      setPageError('Failed to delete video. Try again.');
      toast.error('Failed to delete video');
    } finally {
      setDeletingVideoId(null);
    }
  };

  useEffect(() => {
    fetchFeeds();
    fetchVideos();
  }, []);

  const videoCountsByFeed = useMemo(() => {
    const map = new Map<string, number>();
    for (const v of videos) {
      map.set(v.feedId, (map.get(v.feedId) || 0) + 1);
    }
    return map;
  }, [videos]);

  const filteredVideos = useMemo(() => {
    const q = videoQuery.trim().toLowerCase();
    const selectedFeedName =
      videoFeedFilter === 'all' ? null : feeds.find((f) => f.id === videoFeedFilter)?.name;
    const filtered = videos.filter((v) => {
      const matchesFeed =
        videoFeedFilter === 'all' ||
        v.feedId === videoFeedFilter ||
        (!!selectedFeedName && v.feed?.name === selectedFeedName);
      if (!matchesFeed) return false;
      if (!q) return true;
      return (
        (v.title || '').toLowerCase().includes(q) || (v.feed?.name || '').toLowerCase().includes(q)
      );
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (videoSort === 'title') return (a.title || '').localeCompare(b.title || '');
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return videoSort === 'newest' ? bT - aT : aT - bT;
    });

    if (pendingImport) {
      sorted.unshift({
        id: 'pending-import',
        feedId: 'pending',
        title: 'Importing video…',
        s3Url: pendingImport.url,
        thumbnailUrl: null,
        createdAt: pendingImport.startedAt,
        feed: { name: 'Manual import' },
      } as FeedVideo);
    }

    return sorted;
  }, [feeds, videoFeedFilter, videoQuery, videoSort, videos, pendingImport]);

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <Toaster position="top-right" />
      <div className="mb-6">
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-background to-background/60">
          <FeedsHeroAnimation className="absolute inset-0 opacity-90" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Content Monitor</h1>
                <div className="mt-1 text-sm text-muted-foreground">
                  Connect sources (channels, uploads), ingest videos, and generate clips
                  automatically.
                </div>
              </div>
            </div>
          </div>
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-background/85 via-background/20 to-transparent" />
        </div>
      </div>

      {pageError && (
        <div className="mb-6">
          <Card className="border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30">
            <CardContent className="p-4 text-sm text-red-800 dark:text-red-200">
              {pageError}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Hidden file input for uploads */}
      <input
        type="file"
        accept="video/*"
        className="hidden"
        ref={fileInputRef}
        onChange={handleFileUpload}
      />

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: feed management */}
        <div className="space-y-6 lg:col-span-4">
          {/* Feed List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Sources</CardTitle>
                  <CardDescription>Your monitored channels.</CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{feeds.length}</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsAddFeedOpen(true)}
                    title="Add a source"
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    Add
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-2">
              {isLoadingFeeds ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-[66px] w-full animate-pulse rounded-md border bg-gray-50 dark:bg-zinc-900/30"
                    />
                  ))}
                </div>
              ) : feeds.length === 0 ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  <div className="font-medium text-foreground">No sources yet</div>
                  <div className="mt-1">
                    Add a YouTube or C‑SPAN source URL to start ingesting videos.
                  </div>
                  <div className="mt-3">
                    <Button variant="secondary" size="sm" onClick={() => setIsAddFeedOpen(true)}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add your first source
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  {feeds.map((feed) => (
                    <div
                      key={feed.id}
                      className={cn(
                        'group flex items-start justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-900/40',
                        videoFeedFilter === feed.id &&
                          'border-gray-400 bg-gray-50 dark:border-zinc-600 dark:bg-zinc-900/40'
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setVideoFeedFilter((cur) => (cur === feed.id ? 'all' : feed.id));
                          window.setTimeout(() => {
                            videosHeaderRef.current?.scrollIntoView({
                              behavior: 'smooth',
                              block: 'start',
                            });
                          }, 0);
                        }}
                        title="Filter videos by this source"
                      >
                        <div className="flex items-center gap-2">
                          <div className="truncate font-semibold">{feed.name}</div>
                          {feed.sourceType && (
                            <Badge variant="outline" className="capitalize">
                              {feed.sourceType}
                            </Badge>
                          )}
                          {videoFeedFilter === feed.id ? <Badge>Selected</Badge> : null}
                          <Badge variant="secondary">{videoCountsByFeed.get(feed.id) || 0}</Badge>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {feed.sourceUrl} • every {feed.pollingInterval} min
                          {feed.lastCheckedAt ? (
                            <> • checked {formatRelativeTime(feed.lastCheckedAt)}</>
                          ) : null}
                          {feed.autoGenerateClips && (
                            <span className="ml-2 text-green-600 dark:text-green-400 font-medium whitespace-nowrap">
                              Auto-Gen On
                            </span>
                          )}
                        </div>
                      </button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setSelectedFeedSettings(feed);
                          setIsFeedSettingsOpen(true);
                        }}
                        title="Source Settings"
                      >
                        <Settings className="h-4 w-4" />
                      </Button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        onClick={() => deleteFeed(feed.id)}
                        disabled={deletingFeedId === feed.id}
                        title="Delete source"
                      >
                        <Trash2
                          className={cn('h-4 w-4', deletingFeedId === feed.id && 'animate-pulse')}
                        />
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right: feed videos */}
        <div className="space-y-4 lg:col-span-8">
          <Card className="h-full border-muted/60 shadow-sm">
            <CardHeader className="space-y-4 pb-4" ref={videosHeaderRef}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between scroll-mt-24">
                <div>
                  <CardTitle className="text-xl">Ingested Videos</CardTitle>
                  <CardDescription>
                    Click any video to configure scoring and generate a clip.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{filteredVideos.length} shown</Badge>
                  <Badge variant="outline">{videos.length} ingested</Badge>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setIsAddVideoOpen(true)}
                    disabled={isUploading}
                    className="gap-2 ml-2"
                  >
                    <Upload className="h-4 w-4" />
                    Add Video
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative w-full sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={videoQuery}
                    onChange={(e) => setVideoQuery(e.target.value)}
                    placeholder="Search titles or source…"
                    className="pl-9 pr-9"
                  />
                  {videoQuery.trim().length > 0 && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                      onClick={() => setVideoQuery('')}
                      title="Clear search"
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  )}
                </div>

                <div className="flex w-full items-center gap-2 sm:w-auto">
                  <Select value={videoFeedFilter} onValueChange={setVideoFeedFilter}>
                    <SelectTrigger className="w-full sm:w-[220px]">
                      <SelectValue placeholder="Filter by source" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All sources</SelectItem>
                      {feeds.map((f) => (
                        <SelectItem key={f.id} value={f.id}>
                          {f.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={videoSort}
                    onValueChange={(v) => setVideoSort(v as 'newest' | 'oldest' | 'title')}
                  >
                    <SelectTrigger className="w-full sm:w-[160px]">
                      <SelectValue placeholder="Sort" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="newest">Newest</SelectItem>
                      <SelectItem value="oldest">Oldest</SelectItem>
                      <SelectItem value="title">Title</SelectItem>
                    </SelectContent>
                  </Select>

                  {(videoFeedFilter !== 'all' || videoQuery.trim().length > 0) && (
                    <Button
                      variant="ghost"
                      onClick={() => {
                        setVideoQuery('');
                        setVideoFeedFilter('all');
                      }}
                      className="shrink-0"
                      title="Clear filters"
                    >
                      Clear
                    </Button>
                  )}
                  <Button
                    variant="outline"
                    onClick={fetchVideos}
                    disabled={isLoadingVideos}
                    className="shrink-0"
                    title="Refresh videos"
                  >
                    <RefreshCw className={cn('h-4 w-4', isLoadingVideos && 'animate-spin')} />
                  </Button>
                </div>
              </div>
              {isUploading && (
                <div className="mt-2 text-xs text-muted-foreground">
                  <div className="mb-1 flex justify-between">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-gray-100 dark:bg-zinc-800">
                    <div
                      className="h-full rounded-full bg-black transition-all dark:bg-white"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              )}
            </CardHeader>
            <CardContent>
              {isLoadingVideos ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Card key={idx} className="overflow-hidden border-dashed shadow-none">
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
              ) : videos.length === 0 && !pendingImport ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-gray-100 p-3 dark:bg-zinc-900">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <h3 className="mt-4 text-lg font-semibold">No videos ingested yet</h3>
                  <p className="mt-2 text-sm text-muted-foreground max-w-sm">
                    Once a source is added and polled, videos will appear here. You can also import
                    specific videos manually.
                  </p>
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <Search className="h-8 w-8 text-muted-foreground/50" />
                  <h3 className="mt-4 text-lg font-semibold">No matches found</h3>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Try adjusting your filters or search terms.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {filteredVideos.map((video) => {
                    const isPending = video.id === 'pending-import';
                    return (
                      <Card
                        key={video.id}
                        className={cn(
                          'group cursor-pointer overflow-hidden shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20',
                          isPending && 'cursor-default border-dashed hover:shadow-sm hover:ring-0'
                        )}
                        onClick={() => {
                          if (isPending) return;
                          setAspectRatio((video.aspectRatio as AspectRatio) || '9:16');
                          setSelectedVideo(video);
                          setIsModalOpen(true);
                        }}
                      >
                        <CardContent className="p-0">
                          <div className="relative">
                            {isPending ? (
                              <div className="flex aspect-video w-full flex-col items-center justify-center gap-2 bg-muted/50 text-center">
                                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                                <div className="text-sm font-medium text-foreground">
                                  Importing new video…
                                </div>
                                <p className="text-xs text-muted-foreground px-6">
                                  You can keep working—this entry will update automatically once the
                                  download finishes.
                                </p>
                              </div>
                            ) : (
                              (() => {
                                const isYouTube =
                                  video.s3Url.includes('youtube.com') ||
                                  video.s3Url.includes('youtu.be');
                                const thumb =
                                  video.thumbnailUrl ||
                                  (isYouTube
                                    ? `https://img.youtube.com/vi/${video.s3Url.match(/[?&]v=([^&]+)/)?.[1]}/hqdefault.jpg`
                                    : null);

                                if (isYouTube) {
                                  return (
                                    <div className="relative aspect-video w-full bg-black/5">
                                      {thumb ? (
                                        <img
                                          src={thumb}
                                          alt={video.title}
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <div className="flex h-full items-center justify-center bg-gray-100 text-gray-400">
                                          <span className="text-xs">No preview</span>
                                        </div>
                                      )}
                                      <div className="absolute right-2 bottom-2 rounded bg-black/70 px-1 py-0.5 text-[10px] font-bold text-white">
                                        YouTube
                                      </div>
                                    </div>
                                  );
                                }

                                return (
                                  <video
                                    src={video.s3Url}
                                    poster={video.thumbnailUrl || undefined}
                                    preload="metadata" // Only load partial metadata to be light
                                    muted
                                    playsInline
                                    tabIndex={-1}
                                    className="aspect-video w-full bg-black/5 object-cover"
                                  />
                                );
                              })()
                            )}

                            {!isPending && (
                              <>
                                <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity group-hover:opacity-80" />
                                <div className="pointer-events-none absolute bottom-2 left-2 opacity-0 transition-opacity group-hover:opacity-100">
                                  <div className="rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                                    Generate clip
                                  </div>
                                </div>

                                <Button
                                  variant="secondary"
                                  size="icon"
                                  className="absolute right-2 top-2 h-8 w-8 rounded-full bg-white/85 text-gray-900 opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover:opacity-100 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await deleteVideo(video);
                                  }}
                                  disabled={deletingVideoId === video.id}
                                  title="Delete video"
                                >
                                  <Trash2
                                    className={cn(
                                      'h-4 w-4',
                                      deletingVideoId === video.id && 'animate-pulse'
                                    )}
                                  />
                                </Button>
                              </>
                            )}
                          </div>
                          {isPending ? (
                            <div className="space-y-2 p-4">
                              <div className="font-semibold leading-snug text-foreground">
                                Preparing video
                              </div>
                              <p className="text-xs text-muted-foreground">
                                Downloading from YouTube and transcoding. No action needed.
                              </p>
                            </div>
                          ) : (
                            <div className="space-y-2 p-4">
                              <div className="line-clamp-2 font-semibold leading-snug">
                                {video.title}
                              </div>
                              <div className="flex flex-wrap items-center gap-2 py-2">
                                {video.feed?.name ? (
                                  <Badge variant="secondary" className="my-1">
                                    {video.feed.name}
                                  </Badge>
                                ) : null}
                                {video.createdAt ? (
                                  <span className="text-xs text-muted-foreground my-1">
                                    {formatRelativeTime(video.createdAt)}
                                  </span>
                                ) : null}
                              </div>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <SelectedVideoModal
        video={selectedVideo}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        aspectRatio={aspectRatio}
        onAspectRatioChange={setAspectRatio}
        viralitySettings={viralitySettings}
        onViralitySettingsChange={setViralitySettings}
        onGenerateClip={handleGenerateClip}
        isGeneratingClip={isGeneratingClip}
      />

      {/* Add Feed Modal */}
      <Dialog
        open={isAddFeedOpen}
        onOpenChange={(open) => {
          if (isCreatingFeed) return;
          if (open) {
            // Start with a clean form each time the modal opens.
            setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
          }
          setIsAddFeedOpen(open);
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add a source</DialogTitle>
            <DialogDescription>
              Provide a source URL. The poller will ingest new videos over time.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Name</Label>
              <Input
                placeholder="My YouTube channel"
                value={form.name}
                onChange={(e) => {
                  const nextName = e.target.value;
                  const currentAutoUrl = youtubeHandleUrlFromName(form.name);
                  const nextAutoUrl = youtubeHandleUrlFromName(nextName);

                  // Keep Source URL in sync while it's blank OR still equals the auto-generated value.
                  // If the user manually edits Source URL to something else, we stop overwriting it.
                  const shouldSyncSourceUrl =
                    !form.sourceUrl || form.sourceUrl.trim() === currentAutoUrl;

                  setForm({
                    ...form,
                    name: nextName,
                    ...(shouldSyncSourceUrl ? { sourceUrl: nextAutoUrl } : null),
                  });
                }}
                autoFocus
              />
            </div>
            <div className="space-y-1">
              <Label>Source URL</Label>
              <Input
                placeholder="https://..."
                value={form.sourceUrl}
                onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <Label>Polling interval (min)</Label>
              <Input
                type="number"
                min={1}
                value={String(form.pollingInterval)}
                onChange={(e) => {
                  const next = Math.max(1, Number(e.target.value || 1));
                  setForm({ ...form, pollingInterval: Number.isFinite(next) ? next : 60 });
                }}
              />
            </div>
          </div>

          <DialogFooter className="pt-4 gap-2 sm:gap-2">
            <Button
              variant="outline"
              onClick={() => setIsAddFeedOpen(false)}
              disabled={isCreatingFeed}
            >
              Cancel
            </Button>
            <Button onClick={addFeed} disabled={!form.name || !form.sourceUrl || isCreatingFeed}>
              <Plus className="mr-2 h-4 w-4" />
              {isCreatingFeed ? 'Adding...' : 'Add source'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add Video Dialog (Upload / Import) */}
      <Dialog open={isAddVideoOpen} onOpenChange={setIsAddVideoOpen}>
        <DialogContent className="max-w-md p-6">
          <DialogHeader className="mb-4">
            <DialogTitle>Add Video</DialogTitle>
            <DialogDescription>
              Upload a file from your device or import from a URL.
            </DialogDescription>
          </DialogHeader>

          <div className="flex w-full items-center justify-center gap-2 rounded-lg bg-muted p-1">
            <Button
              variant={activeVideoTab === 'file' ? 'default' : 'ghost'}
              onClick={() => setActiveVideoTab('file')}
              className={cn(
                'flex-1',
                activeVideoTab === 'file' ? 'bg-background text-foreground shadow-sm' : ''
              )}
              size="sm"
            >
              File Upload
            </Button>
            <Button
              variant={activeVideoTab === 'url' ? 'default' : 'ghost'}
              onClick={() => setActiveVideoTab('url')}
              className={cn(
                'flex-1',
                activeVideoTab === 'url' ? 'bg-background text-foreground shadow-sm' : ''
              )}
              size="sm"
            >
              Import URL
            </Button>
          </div>

          <div className="mt-4">
            {activeVideoTab === 'file' ? (
              <div className="space-y-4">
                <div
                  className="flex h-40 w-full cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed bg-gray-50 transition-colors hover:border-gray-400 hover:bg-gray-100 dark:border-zinc-800 dark:bg-zinc-900/50 dark:hover:border-zinc-700 dark:hover:bg-zinc-900"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <div className="rounded-full bg-background p-3 shadow-sm">
                    <Upload className="h-6 w-6 text-muted-foreground" />
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-medium">Click to select video</div>
                    <div className="text-xs text-muted-foreground">MP4, MOV supported</div>
                  </div>
                </div>

                {isUploading && uploadProgress > 0 && (
                  <div className="w-full space-y-2 rounded-md border p-3">
                    <div className="flex justify-between text-xs font-medium">
                      <span>Uploading...</span>
                      <span>{uploadProgress}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-primary transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      />
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>Video URL</Label>
                  <Input
                    placeholder="https://example.com/video.mp4"
                    value={importUrl}
                    onChange={(e) => setImportUrl(e.target.value)}
                    className="font-mono text-sm"
                  />
                  <p className="text-[13px] text-muted-foreground">
                    Provide a direct link to a video file (MP4) or a supported platform URL.
                  </p>
                </div>
                <div className="pt-2">
                  <Button
                    onClick={handleUrlImport}
                    disabled={!importUrl || isUploading}
                    className="w-full"
                  >
                    {isUploading ? (
                      <span className="flex w-full items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Importing video…
                      </span>
                    ) : (
                      'Import Video'
                    )}
                  </Button>
                  {isUploading && (
                    <div className="mt-3 flex items-start gap-3 rounded-md border border-dashed bg-muted/60 p-3 text-left text-sm">
                      <Loader2 className="mt-0.5 h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
                      <div>
                        <div className="font-medium text-foreground">Import in progress</div>
                        <p className="text-xs text-muted-foreground">
                          Large YouTube downloads can take a few minutes. Feel free to close this
                          dialog—your video will appear as soon as the import finishes.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Feed Settings Modal */}
      {selectedFeedSettings && (
        <Dialog open={isFeedSettingsOpen} onOpenChange={setIsFeedSettingsOpen}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Source Settings</DialogTitle>
              <DialogDescription>
                Configure automation for <strong>{selectedFeedSettings.name}</strong>.
              </DialogDescription>
            </DialogHeader>
            <FeedSettingsForm
              feed={selectedFeedSettings}
              onSave={(updates) => updateFeedSettings(selectedFeedSettings.id, updates)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function FeedSettingsForm({ feed, onSave }: { feed: VideoFeed; onSave: (updates: any) => void }) {
  const [autoGen, setAutoGen] = useState(feed.autoGenerateClips || false);
  const [settings, setSettings] = useState(
    (feed.viralitySettings as any) || {
      scoringMode: 'hybrid',
      strictnessPreset: 'balanced',
      includeAudio: false,
      saferClips: true,
      targetPlatform: 'reels',
      contentStyle: 'auto',
      showAdvanced: false,
    }
  );
  const [isSaving, setIsSaving] = useState(false);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-lg border p-4 bg-gray-50 dark:bg-zinc-900/50">
        <div className="space-y-0.5">
          <Label className="text-base">Auto-generate clips</Label>
          <div className="text-sm text-muted-foreground">
            Automatically score and generate clips when new videos appear in this source.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={cn(
              'text-xs font-medium',
              autoGen ? 'text-green-600' : 'text-muted-foreground'
            )}
          >
            {autoGen ? 'On' : 'Off'}
          </span>
          <Switch checked={autoGen} onCheckedChange={setAutoGen} />
        </div>
      </div>

      <div
        className={cn('space-y-4 transition-opacity', !autoGen && 'opacity-50 pointer-events-none')}
      >
        <div className="text-sm font-medium">Virality Settings</div>
        <ViralitySettings value={settings} onChange={setSettings} />
      </div>

      <DialogFooter>
        <Button
          onClick={async () => {
            setIsSaving(true);
            await onSave({ autoGenerateClips: autoGen, viralitySettings: settings });
            setIsSaving(false);
          }}
          disabled={isSaving}
        >
          {isSaving ? 'Saving...' : 'Save Changes'}
        </Button>
      </DialogFooter>
    </div>
  );
}
