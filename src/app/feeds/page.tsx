'use client';

import Link from 'next/link';
import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';
import { set as idbSet, get as idbGet, del as idbDel } from 'idb-keyval';
import ViralitySettings from '@/components/ViralitySettings';
import {
  DEFAULT_VIRALITY_SETTINGS,
  mergeViralitySettings,
  type LLMProvider,
  type ViralitySettingsValue,
} from '@shared/virality';
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
import { CardGridBackground } from '@/app/feeds/_components/CardGridBackground';
import { FeedVideo, VideoFeed } from '@/app/feeds/types';
import { formatRelativeTime } from '@/app/feeds/util/time';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getFeedVideoThumbnail, getVideoSourceUrl } from '@/app/feeds/util/thumbnails';
import CopyableUrl from '@/components/CopyableUrl';
import { cn } from '@/lib/utils';
import {
  FileText,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
  Upload,
  Settings,
  Loader2,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { ThemedToaster } from '@/components/themed-toaster';
import { useSubscription } from '@/hooks/useSubscription';
import { QuotaWarningBanner } from '@/components/QuotaWarningBanner';

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
  const router = useRouter();
  const { status: sessionStatus } = useSession();

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

  const [deletingFeedId, setDeletingFeedId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);

  // Upload state — Map keyed by tracking ID allows concurrent uploads
  const [activeUploads, setActiveUploads] = useState<
    Map<string, { id: string; filename: string; progress: number; startedAt: string }>
  >(new Map());
  const isUploading = activeUploads.size > 0;
  const [isImportingUrl, setIsImportingUrl] = useState(false);

  const [videoQuery, setVideoQuery] = useState('');
  const [videoFeedFilter, setVideoFeedFilter] = useState<string>('all');
  const [videoSort, setVideoSort] = useState<'newest' | 'oldest' | 'title'>('newest');

  const { quota, data: subscriptionData } = useSubscription();

  const [selectedFeedSettings, setSelectedFeedSettings] = useState<VideoFeed | null>(null);
  const [isFeedSettingsOpen, setIsFeedSettingsOpen] = useState(false);
  const [defaultLLMProvider, setDefaultLLMProvider] = useState<LLMProvider>(
    DEFAULT_VIRALITY_SETTINGS.llmProvider
  );

  useEffect(() => {
    let cancelled = false;
    const fetchDefaultProvider = async () => {
      try {
        const res = await fetch('/api/user/llm-provider');
        if (!res.ok) return;
        const data = await res.json();
        const provider: LLMProvider = data?.llmProvider === 'ollama' ? 'ollama' : 'gemini';
        if (cancelled) return;
        setDefaultLLMProvider(provider);
        setViralitySettings((prev) => {
          if (prev.llmProvider !== DEFAULT_VIRALITY_SETTINGS.llmProvider) return prev;
          if (prev.llmProvider === provider) return prev;
          return { ...prev, llmProvider: provider };
        });
      } catch (err) {
        console.warn('Failed to load default LLM provider', err);
      }
    };
    fetchDefaultProvider();
    return () => {
      cancelled = true;
    };
  }, []);

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

  /* 
    AUTO-RESUME LOGIC
    1. On mount, check if there's a pending upload metadata in localStorage.
    2. If yes, check if the file exists in IndexedDB.
    3. If yes, trigger resumeUpload() automatically.
  */
  useEffect(() => {
    const checkResume = async () => {
      try {
        const metaStr = localStorage.getItem('pending-upload-meta');
        if (!metaStr) return;

        const meta = JSON.parse(metaStr);
        // Check if file blob is still in IDB
        const file = await idbGet('pending-upload-file');

        if (file && file.name === meta.filename && file.size === meta.size) {
          console.log('🔄 Found pending upload, resuming automatically...', meta);
          // Trigger resumption
          resumeUpload(file, meta);
        } else {
          // Invalid state, clear it
          console.log('⚠️ Pending upload metadata found but file missing or mismatched. Clearing.');
          localStorage.removeItem('pending-upload-meta');
          await idbDel('pending-upload-file');
        }
      } catch (e) {
        console.error('Auto-resume check failed:', e);
      }
    };

    // Small delay to ensure hydration?
    setTimeout(checkResume, 500);
  }, []);

  const resumeUpload = async (
    file: File,
    meta: { uploadId: string; key: string; filename: string; size: number },
    trackingId?: string
  ) => {
    const tid = trackingId || meta.uploadId;
    // Add/update this upload in the map
    setActiveUploads((prev) => {
      const next = new Map(prev);
      next.set(tid, {
        id: tid,
        filename: meta.filename,
        progress: 0,
        startedAt: new Date().toISOString(),
      });
      return next;
    });

    try {
      // 1. Get list of already uploaded parts
      const listRes = await fetch('/api/uploads/multipart/list-parts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: meta.uploadId, key: meta.key }),
      });

      if (!listRes.ok) throw new Error('Failed to list parts');
      const {
        parts: existingParts,
      }: { parts: { PartNumber: number; ETag: string; Size: number }[] } = await listRes.json();

      const CHUNK_SIZE = 10 * 1024 * 1024;
      const totalParts = Math.ceil(file.size / CHUNK_SIZE);

      // Map of existing parts for O(1) lookup
      const uploadedMap = new Map(existingParts.map((p) => [p.PartNumber, p.ETag]));

      const uploadedPartsList: { PartNumber: number; ETag: string }[] = [
        ...existingParts.map((p) => ({ PartNumber: p.PartNumber, ETag: p.ETag })),
      ];
      let completedPartsCount = existingParts.length;

      // Calculate initial progress
      const initialPercent = Math.round((completedPartsCount / totalParts) * 100);
      setActiveUploads((prev) => {
        const entry = prev.get(tid);
        if (!entry) return prev;
        const next = new Map(prev);
        next.set(tid, { ...entry, progress: initialPercent });
        return next;
      });

      const uploadPart = async (partNumber: number) => {
        const start = (partNumber - 1) * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, file.size);
        const chunk = file.slice(start, end);

        const partUrlRes = await fetch('/api/uploads/multipart/part-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uploadId: meta.uploadId, key: meta.key, partNumber }),
        });

        if (!partUrlRes.ok) throw new Error(`Failed to get URL for part ${partNumber}`);
        const { url } = await partUrlRes.json();

        const uploadRes = await fetch(url, { method: 'PUT', body: chunk });
        if (!uploadRes.ok) throw new Error(`Failed to upload part ${partNumber}`);

        const eTag = uploadRes.headers.get('ETag');
        if (!eTag) throw new Error(`No ETag for part ${partNumber}`);

        return eTag;
      };

      // CONCURRENCY LOOP
      const CONCURRENCY = 4;
      const queue = [];
      for (let i = 1; i <= totalParts; i++) {
        if (!uploadedMap.has(i)) queue.push(i);
      }

      const activeWorkers = new Set<Promise<void>>();

      while (queue.length > 0 || activeWorkers.size > 0) {
        while (queue.length > 0 && activeWorkers.size < CONCURRENCY) {
          const partNum = queue.shift()!;
          const promise = uploadPart(partNum)
            .then((eTag) => {
              uploadedPartsList.push({ PartNumber: partNum, ETag: eTag });
              completedPartsCount++;
              const percent = Math.round((completedPartsCount / totalParts) * 100);
              setActiveUploads((prev) => {
                const entry = prev.get(tid);
                if (!entry) return prev;
                const next = new Map(prev);
                next.set(tid, { ...entry, progress: percent });
                return next;
              });
              activeWorkers.delete(promise);
            })
            .catch((err) => {
              // Basic retry logic could go here, or just fail entire upload
              console.error(err);
              activeWorkers.delete(promise);
              throw err; // Stop everything
            });
          activeWorkers.add(promise);
        }
        if (activeWorkers.size > 0) {
          await Promise.race(activeWorkers);
        }
      }

      // Finalize
      const completeMultiRes = await fetch('/api/uploads/multipart/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: meta.uploadId, key: meta.key, parts: uploadedPartsList }),
      });

      if (!completeMultiRes.ok) throw new Error('Failed to complete multipart upload');

      await fetch('/api/uploads/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: meta.key, filename: meta.filename }),
      });

      toast.success('Upload complete!');

      // CLEANUP
      localStorage.removeItem('pending-upload-meta');
      await idbDel('pending-upload-file');

      await fetchVideos();
    } catch (err) {
      console.error('Resume failed:', err);
      toast.error('Resume failed');
      // Don't clear storage, so user can try refreshing again?
      // Or clear it to avoid stuck loop? Let's keep it for now.
    } finally {
      setActiveUploads((prev) => {
        const next = new Map(prev);
        next.delete(tid);
        return next;
      });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast.error('Please upload a video file');
      return;
    }

    const tempId = `upload-${Date.now()}`;
    setActiveUploads((prev) => {
      const next = new Map(prev);
      next.set(tempId, {
        id: tempId,
        filename: file.name,
        progress: 0,
        startedAt: new Date().toISOString(),
      });
      return next;
    });
    setIsAddVideoOpen(false);

    try {
      // 0. Persistence Hook: Save File and Metadata
      console.log('💾 Persisting file for auto-resume...');
      await idbSet('pending-upload-file', file);

      // 1. Initiate Multipart Upload
      const initRes = await fetch('/api/uploads/multipart/initiate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: file.name, contentType: file.type }),
      });

      if (!initRes.ok) throw new Error('Failed to initiate upload');
      const { uploadId, key } = await initRes.json();

      // Save metadata linked to this upload
      const meta = { uploadId, key, filename: file.name, size: file.size };
      localStorage.setItem('pending-upload-meta', JSON.stringify(meta));

      // 2. Reuse resume logic which handles the looping
      // We pass the SAME file object and metadata we just got
      await resumeUpload(file, meta, tempId);
    } catch (err) {
      console.error(err);
      toast.error('Upload failed');
      // If init failed, we should probably clear storage so it doesn't try to resume a non-existent upload
      localStorage.removeItem('pending-upload-meta');
      await idbDel('pending-upload-file');
      setActiveUploads((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleUrlImport = async () => {
    if (!importUrl) return;

    const tempId = `import-${Date.now()}`;
    setActiveUploads((prev) => {
      const next = new Map(prev);
      next.set(tempId, {
        id: tempId,
        filename: importUrl,
        progress: 0,
        startedAt: new Date().toISOString(),
      });
      return next;
    });
    setIsImportingUrl(true);

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
      await fetchVideos();
      setImportUrl('');
      setIsAddVideoOpen(false);
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || 'Import failed', { id: toastId });
    } finally {
      setIsImportingUrl(false);
      setActiveUploads((prev) => {
        const next = new Map(prev);
        next.delete(tempId);
        return next;
      });
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

  // Clear server-fetched data when the user logs out
  const wasAuthenticated = useRef(false);
  useEffect(() => {
    if (sessionStatus === 'authenticated') {
      wasAuthenticated.current = true;
    } else if (sessionStatus === 'unauthenticated' && wasAuthenticated.current) {
      wasAuthenticated.current = false;
      setFeeds([]);
      setVideos([]);
      setPageError(null);
    }
  }, [sessionStatus]);

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

    for (const upload of Array.from(activeUploads.values())) {
      sorted.unshift({
        id: upload.id,
        feedId: 'uploading',
        videoId: 'uploading',
        title: upload.filename,
        s3Url: '',
        thumbnailUrl: null,
        createdAt: upload.startedAt,
        feed: { name: 'Uploading...' },
        status: 'uploading',
        uploadProgress: upload.progress,
      } as any);
    }

    return sorted;
  }, [feeds, videoFeedFilter, videoQuery, videoSort, videos, activeUploads]);

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <ThemedToaster />
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
          <Card className="border-red-200 bg-red-50/60 dark:border-red-900/60 dark:bg-red-950/30 glass:border-red-500/20 glass:bg-red-950/20">
            <CardContent className="p-4 text-sm text-red-800 dark:text-red-200">
              {pageError}
            </CardContent>
          </Card>
        </div>
      )}

      {quota &&
        subscriptionData &&
        (quota.feeds.warning ||
          quota.feeds.exceeded ||
          quota.clips.warning ||
          quota.clips.exceeded) && (
          <div className="mb-6">
            <QuotaWarningBanner
              quota={quota}
              planName={subscriptionData.plan.name}
              planId={subscriptionData.plan.id}
            />
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
          <Card className="relative overflow-hidden glass:!bg-transparent glass:!shadow-none glass:!border-[var(--glass-border-prominent)] glass:glass-spectral-edge">
            <CardGridBackground className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-0 bg-surface/85 glass:!bg-[#0a0a1a]/15 glass:backdrop-blur-sm" />
            <CardHeader className="relative pb-3">
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
            <CardContent className="relative space-y-2">
              {isLoadingFeeds ? (
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, idx) => (
                    <div
                      key={idx}
                      className="h-[66px] w-full animate-pulse rounded-md border bg-gray-50 dark:bg-zinc-900/30 glass:bg-white/5 glass:border-white/5"
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
                        'group flex items-start justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-900/40 glass:border-white/5 glass:hover:bg-white/8',
                        videoFeedFilter === feed.id &&
                          'border-gray-400 bg-gray-50 dark:border-zinc-600 dark:bg-zinc-900/40 glass:border-white/20 glass:bg-white/8'
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
          <Card className="relative h-full overflow-hidden border-muted/60 shadow-sm glass:!bg-transparent glass:!shadow-none glass:!border-[var(--glass-border-prominent)] glass:glass-spectral-edge">
            <CardGridBackground className="absolute inset-0" />
            <div className="pointer-events-none absolute inset-0 bg-surface/85 glass:!bg-[#0a0a1a]/15 glass:backdrop-blur-sm" />
            <CardHeader className="relative space-y-4 pb-4" ref={videosHeaderRef}>
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
            </CardHeader>
            <CardContent className="relative">
              {isLoadingVideos ? (
                <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, idx) => (
                    <Card key={idx} className="overflow-hidden border-dashed shadow-none">
                      <CardContent className="p-0">
                        <div className="aspect-video w-full animate-pulse bg-gray-100 dark:bg-zinc-900/40 glass:bg-white/5" />
                        <div className="space-y-2 p-4">
                          <div className="h-4 w-4/5 animate-pulse rounded bg-gray-100 dark:bg-zinc-900/40 glass:bg-white/5" />
                          <div className="h-3 w-2/5 animate-pulse rounded bg-gray-100 dark:bg-zinc-900/40 glass:bg-white/5" />
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              ) : videos.length === 0 && activeUploads.size === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <div className="rounded-full bg-gray-100 p-3 dark:bg-zinc-900 glass:bg-white/10">
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
                    // Check if this is our special uploading placeholder
                    const isUploadingItem = (video as any).status === 'uploading';
                    const uploadProgress = (video as any).uploadProgress || 0;

                    if (isUploadingItem) {
                      return (
                        <Card
                          key={video.id + 'uploading'}
                          className="overflow-hidden border-dashed border-2 bg-gray-50/50 dark:bg-zinc-900/20"
                        >
                          <div className="aspect-video w-full flex items-center justify-center bg-muted/20">
                            <div className="text-center p-6 space-y-4 w-full">
                              <Loader2 className="h-8 w-8 animate-spin mx-auto text-muted-foreground" />
                              <div className="space-y-2">
                                <div className="text-sm font-medium truncate px-4">
                                  {video.title}
                                </div>
                                <div className="w-full max-w-[180px] mx-auto h-2 rounded-full bg-muted overflow-hidden">
                                  <div
                                    className="h-full bg-primary transition-all duration-300 ease-out"
                                    style={{ width: `${uploadProgress}%` }}
                                  />
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  {uploadProgress}% uploaded
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="p-4 space-y-2 opacity-50 pointer-events-none">
                            <div className="h-5 w-3/4 rounded bg-muted/40" />
                            <div className="h-4 w-1/2 rounded bg-muted/30" />
                          </div>
                        </Card>
                      );
                    }

                    const { thumbnailUrl, youtubeId } = getFeedVideoThumbnail(video);
                    const isYouTube = Boolean(youtubeId);
                    const videoSourceUrl = getVideoSourceUrl(video);
                    return (
                      <Card
                        key={video.id}
                        className={cn(
                          'group cursor-pointer overflow-hidden shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20'
                        )}
                        onClick={() => {
                          router.push(`/details/${video.id}`);
                        }}
                      >
                        <CardContent className="p-0">
                          <div className="relative">
                            {(() => {
                              if (isYouTube) {
                                return (
                                  <div className="relative aspect-video w-full bg-black/5">
                                    {thumbnailUrl ? (
                                      <img
                                        src={thumbnailUrl}
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
                                  poster={thumbnailUrl || undefined}
                                  preload="metadata" // Only load partial metadata to be light
                                  muted
                                  playsInline
                                  tabIndex={-1}
                                  className="aspect-video w-full bg-black/5 object-cover"
                                />
                              );
                            })()}

                            <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity group-hover:opacity-80" />
                            <div className="pointer-events-none absolute bottom-2 left-2 opacity-0 transition-opacity group-hover:opacity-100">
                              <div className="rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                                View details
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
                              <Trash2 className="h-4 w-4" />
                            </Button>

                            {deletingVideoId === video.id && (
                              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm dark:bg-black/60 glass:!bg-black/50">
                                <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white glass:!text-white">
                                  <Loader2 className="h-5 w-5 animate-spin" />
                                  Deleting…
                                </div>
                              </div>
                            )}
                          </div>

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
                            {videoSourceUrl && (
                              <CopyableUrl url={videoSourceUrl} className="mt-1" />
                            )}
                            <div className="flex flex-wrap gap-2 pt-1">
                              <Button asChild size="sm" variant="secondary">
                                <Link
                                  href={`/details/${video.id}`}
                                  onClick={(e) => e.stopPropagation()}
                                >
                                  <FileText className="mr-2 h-4 w-4" />
                                  Transcript
                                </Link>
                              </Button>
                            </div>
                          </div>
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
                    disabled={!importUrl || isImportingUrl}
                    className="w-full"
                  >
                    {isImportingUrl ? (
                      <span className="flex w-full items-center justify-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Importing video…
                      </span>
                    ) : (
                      'Import Video'
                    )}
                  </Button>
                  {isImportingUrl && (
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
              defaultLLMProvider={defaultLLMProvider}
              onSave={(updates) => updateFeedSettings(selectedFeedSettings.id, updates)}
            />
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

function FeedSettingsForm({
  feed,
  onSave,
  defaultLLMProvider,
}: {
  feed: VideoFeed;
  onSave: (updates: any) => void;
  defaultLLMProvider: LLMProvider;
}) {
  const [autoGen, setAutoGen] = useState(feed.autoGenerateClips || false);
  const [settings, setSettings] = useState<ViralitySettingsValue>(() =>
    mergeViralitySettings(
      (feed.viralitySettings as Partial<ViralitySettingsValue> | null) ?? undefined,
      defaultLLMProvider
    )
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setAutoGen(feed.autoGenerateClips || false);
    setSettings(
      mergeViralitySettings(
        (feed.viralitySettings as Partial<ViralitySettingsValue> | null) ?? undefined,
        defaultLLMProvider
      )
    );
  }, [feed.id, feed.autoGenerateClips, feed.viralitySettings, defaultLLMProvider]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4 bg-gray-50 dark:bg-zinc-900/50 glass:bg-white/5 glass:border-white/10">
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
        <ViralitySettings
          value={settings}
          onChange={setSettings}
          defaultLLMProvider={defaultLLMProvider}
        />
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
