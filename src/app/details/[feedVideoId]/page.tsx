'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import ViralitySettings from '@/components/ViralitySettings';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import {
  ChevronDown,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  ArrowLeft,
  Pencil,
  Trash2,
} from 'lucide-react';
import SpeakerTranscript from '@/components/SpeakerTranscript';
import CopyableUrl from '@/components/CopyableUrl';
import toast from 'react-hot-toast';
import { ThemedToaster } from '@/components/themed-toaster';
import { useSubscription } from '@/hooks/useSubscription';
import { QuotaWarningBanner } from '@/components/QuotaWarningBanner';
import { formatRelativeTime } from '@/app/feeds/util/time';
import { extractYouTubeId } from '@/app/feeds/util/thumbnails';
import {
  DEFAULT_VIRALITY_SETTINGS,
  getStrictnessConfig,
  type LLMProvider,
  type ViralitySettingsValue,
} from '@shared/virality';

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
    userId: string;
    videoId: string;
    title: string;
    s3Url: string;
    thumbnailUrl?: string | null;
    createdAt?: string | null;
    transcript?: string | null;
    transcriptJson?: { start: number; end: number; text: string }[] | null;
    transcriptSource?: string | null;
    feed?: { id: string; name: string; sourceType?: string };
    clipSourceVideoId?: string | null;
    clipSourceVideo?: {
      id: string;
      videoTitle?: string | null;
      s3Url?: string | null;
      createdAt?: string | null;
    } | null;
  };
  jobState: string | null;
  jobMeta: {
    enqueuedAt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
  } | null;
  clips: ClipRecord[];
};

function describeJob(state: string | null, clips: ClipRecord[]) {
  if (!state) {
    return clips.length ? 'Completed' : 'Awaiting worker';
  }
  switch (state) {
    case 'active':
      return 'Generating clips now';
    case 'waiting':
      return clips.length ? 'Queued for more clips' : 'Queued for processing';
    case 'completed':
      return 'Completed';
    case 'delayed':
      return 'Retry scheduled';
    case 'failed':
      return 'Job failed';
    default:
      return 'Status unknown';
  }
}

export default function ClipGroupPage() {
  const params = useParams<{ feedVideoId: string }>();
  const router = useRouter();
  const feedVideoId = params.feedVideoId;

  const [summary, setSummary] = useState<FeedVideoSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [viralitySettings, setViralitySettings] = useState<ViralitySettingsValue>({
    ...DEFAULT_VIRALITY_SETTINGS,
  });
  const [defaultLLMProvider, setDefaultLLMProvider] = useState<LLMProvider>(
    DEFAULT_VIRALITY_SETTINGS.llmProvider
  );
  const [isGenerateDialogOpen, setIsGenerateDialogOpen] = useState(false);
  const [isPersistingDefaultLLM, setIsPersistingDefaultLLM] = useState(false);
  const [isGeneratingClip, setIsGeneratingClip] = useState(false);
  const [generateMessage, setGenerateMessage] = useState<string | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranscriptOpen, setIsTranscriptOpen] = useState(false);
  const [transcribeMessage, setTranscribeMessage] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [deletingClipId, setDeletingClipId] = useState<string | null>(null);
  const { quota, data: subscriptionData, refresh: refreshSubscription } = useSubscription();

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
        if (!res.ok) throw new Error('Failed to load video');
        const data = (await res.json()) as FeedVideoSummary;
        setSummary(data);
      } catch (err) {
        console.error(err);
        setPageError('Could not load this video. Try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [feedVideoId]
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

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

  useEffect(() => {
    if (!summary) return;
    const shouldPoll =
      summary.jobState === 'active' ||
      summary.jobState === 'waiting' ||
      (summary.clips.length === 0 && summary.jobState !== 'failed');
    if (!shouldPoll) return;
    const interval = window.setInterval(() => {
      fetchSummary({ silent: true });
    }, 10000);
    return () => window.clearInterval(interval);
  }, [summary, fetchSummary]);

  const statusLabel = useMemo(
    () => describeJob(summary?.jobState ?? null, summary?.clips ?? []),
    [summary]
  );

  const videoSourceUrl = useMemo(() => {
    if (!summary) return null;
    const fv = summary.feedVideo;
    const ytId =
      extractYouTubeId(fv.s3Url) || (fv.feed?.sourceType === 'youtube' ? fv.videoId || null : null);
    if (ytId) return `https://www.youtube.com/watch?v=${ytId}`;
    return fv.s3Url || null;
  }, [summary]);

  const persistDefaultLLMProvider = async (provider: LLMProvider) => {
    if (!provider || provider === defaultLLMProvider) {
      return;
    }
    setIsPersistingDefaultLLM(true);
    try {
      const res = await fetch('/api/user/llm-provider', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ llmProvider: provider }),
      });
      if (!res.ok) {
        throw new Error('Failed to update default');
      }
      setDefaultLLMProvider(provider);
    } catch (err) {
      console.error('Unable to update default provider', err);
    } finally {
      setIsPersistingDefaultLLM(false);
    }
  };

  const triggerClip = async () => {
    if (!summary) return;
    const { feedVideo } = summary;
    if (!feedVideo.userId) {
      throw new Error('Missing userId for feed video');
    }
    const strictnessConfig = getStrictnessConfig(viralitySettings.strictnessPreset);
    const res = await fetch('/api/trigger-clip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        feedVideoId: feedVideo.id,
        userId: feedVideo.userId,
        aspectRatio,
        scoringMode: viralitySettings.scoringMode,
        includeAudio: viralitySettings.includeAudio,
        saferClips: viralitySettings.saferClips,
        targetPlatform: viralitySettings.targetPlatform,
        contentStyle: viralitySettings.contentStyle,
        llmProvider: viralitySettings.llmProvider,
        ...strictnessConfig,
      }),
    });

    if (!res.ok) {
      throw new Error('Failed to trigger clip');
    }

    return res.json();
  };

  const handleGenerateClip = async () => {
    setIsGeneratingClip(true);
    setGenerateMessage(null);
    try {
      await triggerClip();
      setGenerateMessage('Clip job enqueued.');
      refreshSubscription();
    } catch (err) {
      console.error(err);
      setGenerateMessage('Failed to enqueue clip job.');
    } finally {
      setIsGeneratingClip(false);
    }
  };

  const handleGenerateDialogOpenChange = (open: boolean) => {
    setIsGenerateDialogOpen(open);
    if (open) {
      setGenerateMessage(null);
    }
  };

  const requestTranscription = useCallback(async () => {
    if (!feedVideoId) return;
    setIsTranscribing(true);
    setTranscribeMessage(null);
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/transcribe`, {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data?.error || 'Failed to queue transcription');
      }
      if (data?.alreadyTranscribed) {
        setTranscribeMessage('Transcript already exists. Refreshing...');
        await fetchSummary({ silent: true });
      } else {
        setTranscribeMessage('Transcription queued. Refresh in a moment.');
      }
    } catch (err) {
      console.error(err);
      setTranscribeMessage('Failed to queue transcription.');
    } finally {
      setIsTranscribing(false);
    }
  }, [feedVideoId, fetchSummary]);

  const deleteClip = async (clipId: string) => {
    if (!confirm('Delete this clip?')) return;
    setDeletingClipId(clipId);
    try {
      const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete clip');
      setSummary((prev) =>
        prev ? { ...prev, clips: prev.clips.filter((c) => c.id !== clipId) } : prev
      );
      toast.success('Clip deleted');
    } catch (err) {
      console.error(err);
      toast.error('Failed to delete clip');
    } finally {
      setDeletingClipId(null);
    }
  };

  return (
    <div className="mx-auto w-full max-w-screen-xl px-4 py-6 sm:px-6 lg:px-8">
      <ThemedToaster />
      <div className="mb-4 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push('/feeds')}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to feeds
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchSummary({ silent: true })}
          disabled={refreshing}
        >
          <RefreshCw className={cn('mr-2 h-4 w-4', refreshing && 'animate-spin')} />
          Refresh
        </Button>
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Loading clip details…</div>
          </CardContent>
        </Card>
      ) : pageError ? (
        <Card className="border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="flex flex-col gap-3 p-5 text-sm text-red-800 dark:text-red-200">
            <div>{pageError}</div>
            <Button variant="secondary" size="sm" onClick={() => fetchSummary()} className="w-fit">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : summary ? (
        <>
          <Card className="mb-6">
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>{statusLabel}</Badge>
                {summary.feedVideo.feed?.name ? (
                  <Badge variant="outline">{summary.feedVideo.feed.name}</Badge>
                ) : null}
                {summary.feedVideo.createdAt ? (
                  <Badge variant="outline">
                    Added {formatRelativeTime(summary.feedVideo.createdAt)}
                  </Badge>
                ) : null}
              </div>
              <CardTitle className="text-2xl font-semibold leading-tight">
                {summary.feedVideo.title}
              </CardTitle>
              <CardDescription>
                Clips generated from this video will appear below. Refresh to see latest updates.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <video
                ref={videoRef}
                src={summary.feedVideo.s3Url}
                poster={summary.feedVideo.thumbnailUrl || undefined}
                controls
                preload="metadata"
                playsInline
                className="max-h-[400px] w-full rounded bg-black/5 object-contain"
              />
              {videoSourceUrl && <CopyableUrl url={videoSourceUrl} label="Source" />}
              <div className="flex flex-wrap gap-2">
                <Button asChild variant="secondary">
                  <a href={summary.feedVideo.s3Url} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open original
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <a href={summary.feedVideo.s3Url} download>
                    <Download className="mr-2 h-4 w-4" />
                    Download
                  </a>
                </Button>
                <Dialog open={isGenerateDialogOpen} onOpenChange={handleGenerateDialogOpenChange}>
                  <DialogTrigger asChild>
                    <Button>Generate clips</Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-2xl">
                    <DialogHeader>
                      <DialogTitle>Clip generation settings</DialogTitle>
                      <DialogDescription>
                        Configure scoring and aspect ratio, then queue a clip generation job.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="space-y-4">
                      {quota &&
                        subscriptionData &&
                        (quota.clips.warning || quota.clips.exceeded) && (
                          <QuotaWarningBanner
                            quota={quota}
                            planName={subscriptionData.plan.name}
                            planId={subscriptionData.plan.id}
                            show="clips"
                          />
                        )}
                      <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} />
                      <ViralitySettings
                        value={viralitySettings}
                        onChange={setViralitySettings}
                        defaultLLMProvider={defaultLLMProvider}
                        onPersistLLMProvider={persistDefaultLLMProvider}
                        isPersistingLLMProvider={isPersistingDefaultLLM}
                      />
                      {generateMessage ? (
                        <div className="text-xs text-muted-foreground">{generateMessage}</div>
                      ) : null}
                    </div>
                    <DialogFooter className="gap-2 pt-4 sm:gap-2">
                      <Button
                        onClick={handleGenerateClip}
                        disabled={isGeneratingClip || (quota?.clips.exceeded ?? false)}
                      >
                        {isGeneratingClip ? 'Generating...' : 'Generate clip'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => handleGenerateDialogOpenChange(false)}
                      >
                        Cancel
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </CardContent>
          </Card>

          <Card className="mb-6">
            <CardHeader
              className="cursor-pointer select-none pb-3"
              onClick={() => setIsTranscriptOpen((o) => !o)}
            >
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">Transcript</CardTitle>
                    {summary.feedVideo.transcriptSource && (
                      <Badge variant="outline" className="text-xs font-normal">
                        {summary.feedVideo.transcriptSource === 'youtube-manual'
                          ? 'YouTube captions'
                          : summary.feedVideo.transcriptSource === 'youtube-auto'
                            ? 'YouTube auto-captions'
                            : 'Whisper'}
                      </Badge>
                    )}
                  </div>
                  <CardDescription>Scroll to review the transcript for this video.</CardDescription>
                </div>
                <ChevronDown
                  className={cn(
                    'h-5 w-5 text-muted-foreground transition-transform duration-200',
                    isTranscriptOpen && 'rotate-180'
                  )}
                />
              </div>
            </CardHeader>
            {isTranscriptOpen && (
              <CardContent className="space-y-3">
                {summary.feedVideo.transcript?.trim() ? (
                  <div className="max-h-[360px] overflow-y-auto rounded-md border p-3 text-sm whitespace-pre-wrap leading-relaxed">
                    {summary.feedVideo.transcript}
                  </div>
                ) : (
                  <div className="space-y-3 rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                    <div>Transcript not available yet.</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          requestTranscription();
                        }}
                        disabled={isTranscribing}
                      >
                        {isTranscribing ? 'Queuing...' : 'Transcribe now'}
                      </Button>
                      {transcribeMessage ? <span>{transcribeMessage}</span> : null}
                    </div>
                  </div>
                )}
              </CardContent>
            )}
          </Card>

          <div className="mb-6">
            <SpeakerTranscript
              feedVideoId={feedVideoId}
              onSeek={(time) => {
                if (videoRef.current) {
                  videoRef.current.currentTime = time;
                  videoRef.current.play();
                }
              }}
            />
          </div>

          {summary.clips.length === 0 ? (
            <Card className="border-dashed">
              <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                <div className="text-sm font-medium text-foreground">
                  Clip generation in progress…
                </div>
                <div className="text-xs text-muted-foreground">
                  This page will refresh automatically when clips are ready.
                </div>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">Generated clips</h2>
                <Badge variant="secondary">{summary.clips.length}</Badge>
              </div>
              <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
                {summary.clips.map((clip) => (
                  <Card
                    key={clip.id}
                    className="relative cursor-pointer overflow-hidden shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20"
                    onClick={() => router.push(`/details/${feedVideoId}/clips/${clip.id}`)}
                  >
                    <CardContent className="p-0">
                      <video
                        src={clip.s3Url || undefined}
                        preload="metadata"
                        muted
                        playsInline
                        tabIndex={-1}
                        className="aspect-video w-full bg-black/5 object-cover"
                      />
                      <div className="space-y-2 p-4">
                        <div className="line-clamp-2 font-semibold leading-snug">
                          {clip.videoTitle?.trim()
                            ? clip.videoTitle
                            : summary.feedVideo.title
                              ? `Clip from ${summary.feedVideo.title}`
                              : 'Generated clip'}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="outline">Clip</Badge>
                          {clip.createdAt ? (
                            <span className="text-xs text-muted-foreground">
                              {formatRelativeTime(clip.createdAt)}
                            </span>
                          ) : null}
                        </div>
                        {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions */}
                        <div
                          className="flex flex-wrap gap-2 pt-2"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {clip.s3Url ? (
                            <>
                              <Button asChild size="sm">
                                <a
                                  href={`/details/${feedVideoId}/clips/${clip.id}`}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  <Pencil className="mr-2 h-4 w-4" />
                                  Edit
                                </a>
                              </Button>
                              <Button asChild size="sm" variant="outline">
                                <a href={clip.s3Url} download>
                                  <Download className="mr-2 h-4 w-4" />
                                  Download
                                </a>
                              </Button>
                            </>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive glass:!text-[rgb(var(--color-destructive))] glass:hover:!bg-red-500/10"
                            onClick={() => deleteClip(clip.id)}
                            disabled={deletingClipId === clip.id}
                          >
                            <Trash2 className="mr-2 h-4 w-4" />
                            Delete
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                    {deletingClipId === clip.id && (
                      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-background/80 backdrop-blur-sm dark:bg-black/60 glass:!bg-black/50">
                        <div className="flex items-center gap-2 text-sm font-medium text-foreground dark:text-white glass:!text-white">
                          <Loader2 className="h-5 w-5 animate-spin" />
                          Deleting…
                        </div>
                      </div>
                    )}
                  </Card>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
