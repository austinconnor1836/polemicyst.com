'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Download,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Sparkles,
} from 'lucide-react';
import { formatRelativeTime } from '@/app/feeds/util/time';

type ClipRecord = {
  id: string;
  videoTitle?: string | null;
  sharedDescription?: string | null;
  s3Url?: string | null;
  s3Key?: string | null;
  createdAt?: string | null;
};

type FeedVideoSummary = {
  feedVideo: {
    id: string;
    title: string;
    s3Url: string;
    thumbnailUrl?: string | null;
  };
  clips: ClipRecord[];
};

export default function ClipEditorPage() {
  const params = useParams<{ feedVideoId: string; clipId: string }>();
  const router = useRouter();
  const feedVideoId = params.feedVideoId;
  const clipId = params.clipId;

  const [summary, setSummary] = useState<FeedVideoSummary | null>(null);
  const [clip, setClip] = useState<ClipRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [clipTitle, setClipTitle] = useState('');
  const [description, setDescription] = useState('');
  const [captionStyle, setCaptionStyle] = useState('pop');
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [safeZone, setSafeZone] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const fetchSummary = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!feedVideoId) return;
      if (!options?.silent) {
        setLoading(true);
        setPageError(null);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/feedVideos/${feedVideoId}/clips`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load clip data');
        const data = (await res.json()) as FeedVideoSummary;
        const foundClip = data.clips.find((item) => item.id === clipId) ?? null;
        setSummary(data);
        setClip(foundClip);
        if (!foundClip) {
          setPageError('Clip not found for this video.');
        }
      } catch (err) {
        console.error(err);
        setPageError('Could not load this clip. Try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [feedVideoId, clipId]
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (!clip) return;
    setClipTitle(clip.videoTitle?.trim() || 'Untitled clip');
    setDescription(clip.sharedDescription?.trim() || '');
  }, [clip]);

  useEffect(() => {
    if (!saveMessage) return;
    const timeout = window.setTimeout(() => setSaveMessage(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [saveMessage]);

  const clipLabel = useMemo(() => {
    if (!clip) return 'Clip editor';
    return clip.videoTitle?.trim() || 'Generated clip';
  }, [clip]);

  return (
    <div className="mx-auto w-full max-w-screen-2xl px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/clips/${feedVideoId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to clip list
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchSummary({ silent: true })}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        {clip?.createdAt ? (
          <Badge variant="outline">Created {formatRelativeTime(clip.createdAt)}</Badge>
        ) : null}
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Loading editor...</div>
          </CardContent>
        </Card>
      ) : pageError || !clip ? (
        <Card className="border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="flex flex-col gap-3 p-5 text-sm text-red-800 dark:text-red-200">
            <div>{pageError || 'Clip not found.'}</div>
            <Button variant="secondary" size="sm" onClick={() => fetchSummary()} className="w-fit">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Editing</Badge>
                <Badge variant="secondary">Opus-style editor</Badge>
                {summary?.feedVideo?.title ? (
                  <Badge variant="outline">Source: {summary.feedVideo.title}</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl font-semibold">{clipLabel}</CardTitle>
                  <CardDescription>
                    Refine the clip, captions, and layout before exporting.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setSaveMessage('Draft saved locally.')}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save draft
                  </Button>
                  {clip.s3Url ? (
                    <Button asChild>
                      <a href={clip.s3Url} download>
                        <Download className="mr-2 h-4 w-4" />
                        Export video
                      </a>
                    </Button>
                  ) : (
                    <Button disabled>Export video</Button>
                  )}
                </div>
              </div>
              {saveMessage ? <div className="text-xs text-muted-foreground">{saveMessage}</div> : null}
            </CardHeader>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
            <div className="space-y-6">
              <Card className="overflow-hidden">
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Preview</CardTitle>
                  <CardDescription>
                    Adjust framing, safe areas, and caption placement in real time.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="relative overflow-hidden rounded-2xl border bg-black">
                    <video
                      src={clip.s3Url || undefined}
                      poster={summary?.feedVideo?.thumbnailUrl || undefined}
                      controls
                      preload="metadata"
                      playsInline
                      className="h-[420px] w-full bg-black object-contain"
                    />
                    {safeZone ? (
                      <>
                        <div className="pointer-events-none absolute inset-8 rounded-xl border border-white/30" />
                        <div className="pointer-events-none absolute inset-4 rounded-lg border border-white/10" />
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-4 w-4" />
                      Smart framing enabled for 9:16 output.
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsPlaying((prev) => !prev)}
                    >
                      {isPlaying ? (
                        <>
                          <PauseCircle className="mr-2 h-4 w-4" />
                          Pause
                        </>
                      ) : (
                        <>
                          <PlayCircle className="mr-2 h-4 w-4" />
                          Play
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Timeline</CardTitle>
                  <CardDescription>Trim the clip or move the hook window.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <span>00:00</span>
                      <span>00:47</span>
                    </div>
                    <div className="relative h-16 overflow-hidden rounded-lg border bg-muted/40">
                      <div className="absolute inset-0 flex gap-1 p-2">
                        {Array.from({ length: 12 }).map((_, index) => (
                          <div
                            key={`segment-${index}`}
                            className={cn(
                              'h-full flex-1 rounded-sm',
                              index % 3 === 0
                                ? 'bg-emerald-200/80 dark:bg-emerald-500/30'
                                : 'bg-slate-200/80 dark:bg-slate-700/40'
                            )}
                          />
                        ))}
                      </div>
                      <div className="absolute inset-y-0 left-[12%] w-1.5 rounded bg-white/90 shadow-sm" />
                      <div className="absolute inset-y-0 right-[14%] w-1.5 rounded bg-white/90 shadow-sm" />
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Clip start</Label>
                      <Input type="text" defaultValue="00:06.2" />
                    </div>
                    <div className="space-y-2">
                      <Label>Clip end</Label>
                      <Input type="text" defaultValue="00:43.8" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label>Hook emphasis</Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      defaultValue={72}
                      className="w-full accent-black"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="space-y-6">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Clip details</CardTitle>
                  <CardDescription>Metadata shown on social exports.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="clip-title">Title</Label>
                    <Input
                      id="clip-title"
                      value={clipTitle}
                      onChange={(event) => setClipTitle(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clip-description">Description</Label>
                    <Textarea
                      id="clip-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Add a short description or hook."
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Layout</CardTitle>
                  <CardDescription>Aspect ratio and safe area guides.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} />
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Safe zone overlay</p>
                      <p className="text-xs text-muted-foreground">
                        Keep captions inside platform UI bounds.
                      </p>
                    </div>
                    <Switch checked={safeZone} onCheckedChange={setSafeZone} />
                  </div>
                  <div className="space-y-2">
                    <Label>Background fill</Label>
                    <Select defaultValue="blur">
                      <SelectTrigger>
                        <SelectValue placeholder="Choose background" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blur">Blurred original</SelectItem>
                        <SelectItem value="solid">Solid black</SelectItem>
                        <SelectItem value="gradient">Dark gradient</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Captions</CardTitle>
                  <CardDescription>Auto captions with brand styling.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Auto captions</p>
                      <p className="text-xs text-muted-foreground">
                        Sync transcript to on-screen text.
                      </p>
                    </div>
                    <Switch checked={autoCaptions} onCheckedChange={setAutoCaptions} />
                  </div>
                  <div className="space-y-2">
                    <Label>Caption style</Label>
                    <Select value={captionStyle} onValueChange={setCaptionStyle}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select style" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pop">Pop (bold + outline)</SelectItem>
                        <SelectItem value="clean">Clean minimal</SelectItem>
                        <SelectItem value="cinema">Cinema lower-third</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Caption placement</Label>
                    <Select defaultValue="lower">
                      <SelectTrigger>
                        <SelectValue placeholder="Select placement" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lower">Lower third</SelectItem>
                        <SelectItem value="center">Centered</SelectItem>
                        <SelectItem value="top">Top headline</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
