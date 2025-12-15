'use client';

import { useMemo, useRef, useState, useEffect } from 'react';
import ViralitySettings, { getStrictnessConfig, ScoringMode, StrictnessPreset, type ContentStyle, type TargetPlatform } from "@/components/ViralitySettings";
import AspectRatioSelect, { type AspectRatio } from "@/components/AspectRatioSelect";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { FeedsHeroAnimation } from "@/app/feeds/_components/FeedsHeroAnimation";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { Toaster, toast } from "react-hot-toast";

function formatRelativeTime(iso?: string | null) {
  if (!iso) return null;
  const date = new Date(iso);
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const absSeconds = Math.abs(seconds);

  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

  if (absSeconds < 60) return rtf.format(seconds, "second");
  const minutes = Math.round(seconds / 60);
  if (Math.abs(minutes) < 60) return rtf.format(minutes, "minute");
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return rtf.format(hours, "hour");
  const days = Math.round(hours / 24);
  return rtf.format(days, "day");
}

type VideoFeed = {
  id: string;
  name: string;
  sourceUrl: string;
  sourceType?: string;
  pollingInterval: number;
  lastCheckedAt?: string | null;
  createdAt?: string;
};

type FeedVideo = {
  id: string;
  feedId: string;
  title: string;
  s3Url: string;
  createdAt?: string;
  feed?: { name: string };
  userId?: string;
  aspectRatio?: string;
};

export default function FeedsPage() {
  const videosHeaderRef = useRef<HTMLDivElement | null>(null);

  const [feeds, setFeeds] = useState<VideoFeed[]>([]);
  const [videos, setVideos] = useState<FeedVideo[]>([]);
  const [form, setForm] = useState({ name: '', sourceUrl: '', pollingInterval: 60 });

  const [isLoadingFeeds, setIsLoadingFeeds] = useState(false);
  const [isLoadingVideos, setIsLoadingVideos] = useState(false);
  const [isCreatingFeed, setIsCreatingFeed] = useState(false);
  const [deletingFeedId, setDeletingFeedId] = useState<string | null>(null);
  const [deletingVideoId, setDeletingVideoId] = useState<string | null>(null);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);

  const [videoQuery, setVideoQuery] = useState("");
  const [videoFeedFilter, setVideoFeedFilter] = useState<string>("all");
  const [videoSort, setVideoSort] = useState<"newest" | "oldest" | "title">("newest");

  const [selectedVideo, setSelectedVideo] = useState<FeedVideo | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>("9:16");
  const [viralitySettings, setViralitySettings] = useState<{
    scoringMode: ScoringMode;
    strictnessPreset: StrictnessPreset;
    includeAudio: boolean;
    saferClips: boolean;
    targetPlatform: TargetPlatform;
    contentStyle: ContentStyle;
    showAdvanced: boolean;
  }>({
    scoringMode: "hybrid",
    strictnessPreset: "balanced",
    includeAudio: false,
    saferClips: true,
    targetPlatform: "reels",
    contentStyle: "auto",
    showAdvanced: false,
  });

  const fetchFeeds = async () => {
    setIsLoadingFeeds(true);
    setPageError(null);
    try {
      const res = await fetch('/api/feeds');
      if (!res.ok) throw new Error("Failed to load feeds");
      const data = await res.json();
      setFeeds(data);
    } catch (err) {
      console.error(err);
      setPageError("Couldn’t load feeds. Try refreshing.");
      toast.error("Couldn’t load feeds");
    } finally {
      setIsLoadingFeeds(false);
    }
  };

  const fetchVideos = async () => {
    setIsLoadingVideos(true);
    setPageError(null);
    try {
      const res = await fetch('/api/feedVideos');
      if (!res.ok) throw new Error("Failed to load videos");
      const data = await res.json();
      setVideos(data);
    } catch (err) {
      console.error(err);
      setPageError("Couldn’t load feed videos. Try refreshing.");
      toast.error("Couldn’t load feed videos");
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
      if (!res.ok) throw new Error("Failed to create feed");
      setForm({ name: '', sourceUrl: '', pollingInterval: 60 });
      await fetchFeeds();
      toast.success("Feed added");
    } catch (err) {
      console.error(err);
      setPageError("Couldn’t add feed. Check the URL and try again.");
      toast.error("Couldn’t add feed");
    } finally {
      setIsCreatingFeed(false);
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
          aspectRatio: video.aspectRatio || "9:16",
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
      toast.success("Clip job enqueued");
    } catch (err) {
      console.error(err);
      toast.error("Failed to trigger clip job");
    }
  };

  const deleteFeed = async (feedId: string) => {
    if (!confirm("Delete this feed and all ingested videos?")) return;
    setDeletingFeedId(feedId);
    setPageError(null);
    try {
      const res = await fetch(`/api/feeds/${feedId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Failed to delete feed");
      await Promise.all([fetchFeeds(), fetchVideos()]);
      toast.success("Feed deleted");
    } catch (err) {
      console.error(err);
      setPageError("Failed to delete feed. Try again.");
      toast.error("Failed to delete feed");
    } finally {
      setDeletingFeedId(null);
    }
  };

  const deleteVideo = async (video: FeedVideo) => {
    if (!confirm(`Delete video '${video.title}'?`)) return;
    setDeletingVideoId(video.id);
    setPageError(null);
    try {
      const res = await fetch(`/api/feedVideos/${video.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete video");
      setVideos((prev) => prev.filter((v) => v.id !== video.id));
      toast.success("Video deleted");
    } catch (err) {
      console.error(err);
      setPageError("Failed to delete video. Try again.");
      toast.error("Failed to delete video");
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
    const selectedFeedName = videoFeedFilter === "all" ? null : feeds.find((f) => f.id === videoFeedFilter)?.name;
    const filtered = videos.filter((v) => {
      const matchesFeed =
        videoFeedFilter === "all" ||
        v.feedId === videoFeedFilter ||
        (!!selectedFeedName && v.feed?.name === selectedFeedName);
      if (!matchesFeed) return false;
      if (!q) return true;
      return (v.title || "").toLowerCase().includes(q) || (v.feed?.name || "").toLowerCase().includes(q);
    });

    const sorted = [...filtered];
    sorted.sort((a, b) => {
      if (videoSort === "title") return (a.title || "").localeCompare(b.title || "");
      const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return videoSort === "newest" ? bT - aT : aT - bT;
    });

    return sorted;
  }, [feeds, videoFeedFilter, videoQuery, videoSort, videos]);

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <Toaster position="top-right" />
      <div className="mb-6">
        <div className="relative overflow-hidden rounded-2xl border bg-gradient-to-b from-background to-background/60">
          <FeedsHeroAnimation className="absolute inset-0 opacity-90" />
          <div className="relative p-6 sm:p-8">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h1 className="text-3xl font-semibold tracking-tight">Video Feeds</h1>
                <div className="mt-1 text-sm text-muted-foreground">
                  Create a feed, let it ingest videos, then generate clips with your scoring settings.
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
            <CardContent className="p-4 text-sm text-red-800 dark:text-red-200">{pageError}</CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Left: feed management */}
        <div className="space-y-6 lg:col-span-4">
          {/* Form */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Add feed</CardTitle>
              <CardDescription>Polling runs in the background.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Name</Label>
                <Input
                  placeholder="My YouTube channel"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
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
                  onChange={(e) => setForm({ ...form, pollingInterval: +e.target.value })}
                />
              </div>
              <div className="flex justify-end">
                <Button onClick={addFeed} disabled={!form.name || !form.sourceUrl || isCreatingFeed}>
                  <Plus className="mr-2 h-4 w-4" />
                  {isCreatingFeed ? "Adding..." : "Add feed"}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Feed List */}
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-base">Feeds</CardTitle>
                  <CardDescription>Your ingested sources.</CardDescription>
                </div>
                <Badge variant="secondary">{feeds.length}</Badge>
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
                  No feeds yet. Add a YouTube/RSS source URL above to start ingesting videos.
                </div>
              ) : (
                <div className="space-y-2">
                  {feeds.map((feed) => (
                    <div
                      key={feed.id}
                      className={cn(
                        "group flex items-start justify-between gap-3 rounded-md border p-3 transition-colors hover:bg-gray-50 dark:hover:bg-zinc-900/40",
                        videoFeedFilter === feed.id && "border-gray-400 bg-gray-50 dark:border-zinc-600 dark:bg-zinc-900/40"
                      )}
                    >
                      <button
                        type="button"
                        className="min-w-0 flex-1 text-left"
                        onClick={() => {
                          setVideoFeedFilter((cur) => (cur === feed.id ? "all" : feed.id));
                          window.setTimeout(() => {
                            videosHeaderRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                          }, 0);
                        }}
                        title="Filter videos by this feed"
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
                          {feed.lastCheckedAt ? <> • checked {formatRelativeTime(feed.lastCheckedAt)}</> : null}
                        </div>
                      </button>

                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-9 w-9 text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                        onClick={() => deleteFeed(feed.id)}
                        disabled={deletingFeedId === feed.id}
                        title="Delete feed"
                      >
                        <Trash2 className={cn("h-4 w-4", deletingFeedId === feed.id && "animate-pulse")} />
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
          <div ref={videosHeaderRef} className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between scroll-mt-24">
            <div>
              <h2 className="text-xl font-semibold tracking-tight">Feed videos</h2>
              <div className="text-sm text-muted-foreground">Click any video to configure scoring and generate a clip.</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary">{filteredVideos.length} shown</Badge>
              <Badge variant="outline">{videos.length} ingested</Badge>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full sm:max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={videoQuery}
                onChange={(e) => setVideoQuery(e.target.value)}
                placeholder="Search titles or feed…"
                className="pl-9 pr-9"
              />
              {videoQuery.trim().length > 0 && (
                <Button
                  variant="ghost"
                  size="icon"
                  className="absolute right-1 top-1/2 h-8 w-8 -translate-y-1/2"
                  onClick={() => setVideoQuery("")}
                  title="Clear search"
                >
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>

            <div className="flex w-full items-center gap-2 sm:w-auto">
              <Select value={videoFeedFilter} onValueChange={setVideoFeedFilter}>
                <SelectTrigger className="w-full sm:w-[220px]">
                  <SelectValue placeholder="Filter by feed" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All feeds</SelectItem>
                  {feeds.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={videoSort} onValueChange={(v) => setVideoSort(v as "newest" | "oldest" | "title")}>
                <SelectTrigger className="w-full sm:w-[160px]">
                  <SelectValue placeholder="Sort" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="newest">Newest</SelectItem>
                  <SelectItem value="oldest">Oldest</SelectItem>
                  <SelectItem value="title">Title</SelectItem>
                </SelectContent>
              </Select>

              {(videoFeedFilter !== "all" || videoQuery.trim().length > 0) && (
                <Button
                  variant="ghost"
                  onClick={() => {
                    setVideoQuery("");
                    setVideoFeedFilter("all");
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
                <RefreshCw className={cn("h-4 w-4", isLoadingVideos && "animate-spin")} />
              </Button>
            </div>
          </div>

          {isLoadingVideos ? (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {Array.from({ length: 6 }).map((_, idx) => (
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
          ) : videos.length === 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">No videos ingested yet</CardTitle>
                <CardDescription>Once a feed is added and polled, videos will appear here for clip generation.</CardDescription>
              </CardHeader>
            </Card>
          ) : filteredVideos.length === 0 ? (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-base">No matches</CardTitle>
                <CardDescription>Try a different search or clear the feed filter.</CardDescription>
              </CardHeader>
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
              {filteredVideos.map((video) => (
                <Card
                  key={video.id}
                  className="group cursor-pointer overflow-hidden shadow-sm transition-shadow hover:shadow-md"
                  onClick={() => {
                    setAspectRatio((video.aspectRatio as AspectRatio) || "9:16");
                    setSelectedVideo(video);
                    setIsModalOpen(true);
                  }}
                >
                  <CardContent className="p-0">
                    <div className="relative">
                      <video
                        src={video.s3Url}
                        preload="metadata"
                        muted
                        playsInline
                        tabIndex={-1}
                        className="aspect-video w-full bg-black/5 object-cover"
                      />
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
                        <Trash2 className={cn("h-4 w-4", deletingVideoId === video.id && "animate-pulse")} />
                      </Button>
                    </div>
                    <div className="space-y-2 p-4">
                      <div className="line-clamp-2 font-semibold leading-snug">{video.title}</div>
                      <div className="flex flex-wrap items-center gap-2">
                        {video.feed?.name ? <Badge variant="secondary">{video.feed.name}</Badge> : null}
                        {video.createdAt ? (
                          <span className="text-xs text-muted-foreground">{formatRelativeTime(video.createdAt)}</span>
                        ) : null}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Modal */}
      {selectedVideo && (
        <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
          <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle className="leading-snug">{selectedVideo.title}</DialogTitle>
              <DialogDescription>Configure clip generation settings.</DialogDescription>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {selectedVideo.feed?.name ? <Badge variant="secondary">{selectedVideo.feed.name}</Badge> : null}
                {selectedVideo.createdAt ? <Badge variant="outline">Added {formatRelativeTime(selectedVideo.createdAt)}</Badge> : null}
              </div>
            </DialogHeader>

            <video
              src={selectedVideo.s3Url}
              controls
              preload="metadata"
              playsInline
              className="mb-4 max-h-[35vh] w-full rounded object-contain"
            />

            <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} className="mb-4" />
            <ViralitySettings value={viralitySettings} onChange={setViralitySettings} />

            <DialogFooter className="pt-4 gap-2 sm:gap-2">
              <Button
                onClick={async () => {
                  setIsGeneratingClip(true);
                  try {
                    await triggerClip({ ...selectedVideo, aspectRatio });
                    setIsModalOpen(false);
                  } finally {
                    setIsGeneratingClip(false);
                  }
                }}
                disabled={isGeneratingClip}
              >
                {isGeneratingClip ? "Generating..." : "Generate clip"}
              </Button>
              <Button variant="outline" onClick={() => setIsModalOpen(false)}>
                Cancel
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
