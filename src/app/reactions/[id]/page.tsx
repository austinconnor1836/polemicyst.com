'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2, RefreshCw, Share2 } from 'lucide-react';
import { ModeSelector } from '../_components/ModeSelector';
import { VideoUploader, type DeferredFileData } from '../_components/VideoUploader';
import { CreatorVideoPanel } from '../_components/CreatorVideoPanel';
import { ReferenceTrackPanel } from '../_components/ReferenceTrackPanel';
import { TimelineEditor } from '../_components/TimelineEditor';
import { AudioMixPanel } from '../_components/AudioMixPanel';
import { RenderControls, type LocalOutput } from '../_components/RenderControls';
import { ThumbnailPanel } from '../_components/ThumbnailPanel';
import { TrimModal } from '../_components/TrimModal';
import { PublishModal } from '@/components/PublishModal';
import { probeVideoFile } from '../_lib/client-probe';
import { uploadFileToS3 } from '../_lib/upload-to-s3';
import toast from 'react-hot-toast';
import Link from 'next/link';

interface Track {
  id: string;
  label?: string | null;
  s3Key: string;
  s3Url: string;
  durationS: number;
  width?: number | null;
  height?: number | null;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
  sortOrder: number;
  hasAudio: boolean;
}

interface Output {
  id: string;
  layout: string;
  status: string;
  s3Url?: string | null;
  renderError?: string | null;
  durationMs?: number | null;
  transcript?: string | null;
}

interface Composition {
  id: string;
  title: string;
  mode: string;
  status: string;
  audioMode: string;
  creatorVolume: number;
  referenceVolume: number;
  creatorS3Key?: string | null;
  creatorS3Url?: string | null;
  creatorDurationS?: number | null;
  creatorWidth?: number | null;
  creatorHeight?: number | null;
  creatorTrimStartS: number;
  creatorTrimEndS?: number | null;
  tracks: Track[];
  outputs: Output[];
}

/** Tracks a locally-selected file not yet uploaded to S3 */
interface PendingFile {
  file: File;
  blobUrl: string;
}

const LOCAL_ID_PREFIX = 'local-';

function isLocalId(id: string): boolean {
  return id.startsWith(LOCAL_ID_PREFIX);
}

let localIdCounter = 0;
function nextLocalId(): string {
  return `${LOCAL_ID_PREFIX}${++localIdCounter}`;
}

function detectOutputLayouts(): ('mobile' | 'landscape')[] {
  return ['mobile', 'landscape'];
}

function statusBadge(status: string) {
  switch (status) {
    case 'completed':
      return (
        <Badge className="bg-green-100 text-green-700 dark:bg-green-900/50 dark:text-green-300">
          Completed
        </Badge>
      );
    case 'rendering':
      return (
        <Badge className="bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
          Rendering
        </Badge>
      );
    case 'failed':
      return (
        <Badge className="bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
          Failed
        </Badge>
      );
    default:
      return <Badge variant="outline">Draft</Badge>;
  }
}

export default function CompositionEditorPage() {
  const params = useParams();
  const router = useRouter();
  const compositionId = params.id as string;

  const [composition, setComposition] = useState<Composition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [deletingCreator, setDeletingCreator] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [thumbnailGenerating, setThumbnailGenerating] = useState(false);
  const thumbnailRegenerateRef = useRef<(() => void) | null>(null);
  const [trimTarget, setTrimTarget] = useState<{
    type: 'creator' | 'reference';
    trackId?: string;
    src: string;
    durationS: number;
    trimStartS: number;
    trimEndS: number | null;
    title: string;
  } | null>(null);

  // Pending local files: creator video and reference tracks not yet uploaded to S3
  const [pendingCreator, setPendingCreator] = useState<PendingFile | null>(null);
  const [pendingTracks, setPendingTracks] = useState<Map<string, PendingFile>>(new Map());

  // Rendered output blobs (downloaded from server after render)
  const [localOutputs, setLocalOutputs] = useState<Map<string, LocalOutput>>(new Map());

  const fetchComposition = useCallback(async () => {
    try {
      const res = await fetch(`/api/compositions/${compositionId}`);
      if (!res.ok) {
        if (res.status === 404) {
          router.push('/reactions');
          return;
        }
        throw new Error('Failed to load');
      }
      const data = await res.json();
      setComposition(data);
    } catch {
      toast.error('Failed to load composition');
    } finally {
      setLoading(false);
    }
  }, [compositionId, router]);

  useEffect(() => {
    fetchComposition();
  }, [fetchComposition]);

  // Cleanup blob URLs on unmount
  useEffect(() => {
    return () => {
      if (pendingCreator) URL.revokeObjectURL(pendingCreator.blobUrl);
      pendingTracks.forEach((p) => URL.revokeObjectURL(p.blobUrl));
      localOutputs.forEach((lo) => URL.revokeObjectURL(lo.blobUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = useCallback(
    async (updates: Partial<Composition>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/compositions/${compositionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });
        if (!res.ok) throw new Error('Save failed');
        const data = await res.json();
        setComposition(data);
      } catch {
        toast.error('Failed to save');
      } finally {
        setSaving(false);
      }
    },
    [compositionId]
  );

  const probeVideo = useCallback(
    async (
      s3Key: string
    ): Promise<{ durationS: number; width: number; height: number; hasAudio: boolean } | null> => {
      try {
        const res = await fetch('/api/compositions/probe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ s3Key }),
        });
        if (!res.ok) return null;
        return await res.json();
      } catch {
        return null;
      }
    },
    []
  );

  // --- Creator video: deferred file selection ---
  const handleCreatorFileSelected = useCallback(
    async (data: DeferredFileData) => {
      try {
        const probe = await probeVideoFile(data.file);

        // Revoke old blob URL if replacing
        if (pendingCreator) URL.revokeObjectURL(pendingCreator.blobUrl);

        setPendingCreator({ file: data.file, blobUrl: data.blobUrl });

        // Update composition state with local preview data
        setComposition((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            creatorS3Key: null,
            creatorS3Url: data.blobUrl,
            creatorDurationS: probe.durationS,
            creatorWidth: probe.width,
            creatorHeight: probe.height,
          };
        });
      } catch {
        toast.error('Failed to read video file');
      }
    },
    [pendingCreator]
  );

  const handleCreatorUploaded = useCallback(
    async (data: { s3Key: string; s3Url: string }) => {
      const probe = await probeVideo(data.s3Key);
      await save({
        creatorS3Key: data.s3Key,
        creatorS3Url: data.s3Url,
        creatorDurationS: probe?.durationS ?? null,
        creatorWidth: probe?.width ?? null,
        creatorHeight: probe?.height ?? null,
      } as any);
    },
    [save, probeVideo]
  );

  // --- Reference tracks: deferred file selection ---
  const handleTrackFileSelected = useCallback(async (data: DeferredFileData) => {
    try {
      const probe = await probeVideoFile(data.file);
      const localId = nextLocalId();

      setPendingTracks((prev) => {
        const next = new Map(prev);
        next.set(localId, { file: data.file, blobUrl: data.blobUrl });
        return next;
      });

      setComposition((prev) => {
        if (!prev) return prev;
        const newTrack: Track = {
          id: localId,
          label: data.filename,
          s3Key: '',
          s3Url: data.blobUrl,
          durationS: probe.durationS,
          width: probe.width,
          height: probe.height,
          startAtS: 0,
          trimStartS: 0,
          trimEndS: null,
          sortOrder: prev.tracks.length,
          hasAudio: probe.hasAudio,
        };
        return { ...prev, tracks: [...prev.tracks, newTrack] };
      });

      toast.success('Reference clip added (local)');
    } catch {
      toast.error('Failed to read video file');
    }
  }, []);

  const handleAddTrack = useCallback(
    async (data: { s3Key: string; s3Url: string; filename: string }) => {
      try {
        const probe = await probeVideo(data.s3Key);
        const res = await fetch(`/api/compositions/${compositionId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s3Key: data.s3Key,
            s3Url: data.s3Url,
            label: data.filename,
            durationS: probe?.durationS ?? 10,
            width: probe?.width ?? null,
            height: probe?.height ?? null,
            hasAudio: probe?.hasAudio ?? true,
          }),
        });
        if (!res.ok) throw new Error('Failed to add track');
        await fetchComposition();
        toast.success('Reference track added');
      } catch {
        toast.error('Failed to add track');
      }
    },
    [compositionId, fetchComposition, probeVideo]
  );

  const handleUpdateTrack = useCallback(
    async (trackId: string, data: Partial<Track>) => {
      if (isLocalId(trackId)) {
        // Local track: update state only, no API call
        setComposition((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, ...data } : t)),
          };
        });
        return;
      }
      try {
        const res = await fetch(`/api/compositions/${compositionId}/tracks/${trackId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to update track');
        setComposition((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, ...data } : t)),
          };
        });
      } catch {
        toast.error('Failed to update track');
      }
    },
    [compositionId]
  );

  const handleRemoveTrack = useCallback(
    async (trackId: string) => {
      if (!confirm('Remove this reference track?')) return;

      if (isLocalId(trackId)) {
        // Local track: remove from state, revoke blob URL, no API call
        setPendingTracks((prev) => {
          const next = new Map(prev);
          const pending = next.get(trackId);
          if (pending) URL.revokeObjectURL(pending.blobUrl);
          next.delete(trackId);
          return next;
        });
        setComposition((prev) => {
          if (!prev) return prev;
          return { ...prev, tracks: prev.tracks.filter((t) => t.id !== trackId) };
        });
        toast.success('Track removed');
        return;
      }

      setDeletingTrackId(trackId);
      try {
        const res = await fetch(`/api/compositions/${compositionId}/tracks/${trackId}`, {
          method: 'DELETE',
        });
        if (!res.ok) throw new Error('Failed to remove track');
        setComposition((prev) => {
          if (!prev) return prev;
          return { ...prev, tracks: prev.tracks.filter((t) => t.id !== trackId) };
        });
        toast.success('Track removed');
      } catch {
        toast.error('Failed to remove track');
      } finally {
        setDeletingTrackId(null);
      }
    },
    [compositionId]
  );

  const handleTrackMove = useCallback(
    (trackId: string, startAtS: number) => {
      handleUpdateTrack(trackId, { startAtS });
    },
    [handleUpdateTrack]
  );

  const handleStatusChange = useCallback((status: string, outputs: Output[]) => {
    setComposition((prev) => {
      if (!prev) return prev;
      return { ...prev, status, outputs };
    });
  }, []);

  const handleTrimSave = useCallback(
    async (trimStartS: number, trimEndS: number) => {
      if (!trimTarget) return;
      if (trimTarget.type === 'creator') {
        if (pendingCreator) {
          // Local creator: update state only
          setComposition((prev) => {
            if (!prev) return prev;
            return { ...prev, creatorTrimStartS: trimStartS, creatorTrimEndS: trimEndS };
          });
          toast.success('Creator trim updated');
        } else {
          await save({ creatorTrimStartS: trimStartS, creatorTrimEndS: trimEndS } as any);
          toast.success('Creator trim updated');
        }
      } else if (trimTarget.trackId) {
        await handleUpdateTrack(trimTarget.trackId, { trimStartS, trimEndS });
        toast.success('Track trim updated');
      }
      setTrimTarget(null);
    },
    [trimTarget, save, handleUpdateTrack, pendingCreator]
  );

  // --- Silently upload pending files before render ---
  const handleBeforeRender = useCallback(async (): Promise<boolean> => {
    const keyPrefix = `compositions/${compositionId}/raw`;
    const hasPending = !!pendingCreator || pendingTracks.size > 0;
    if (!hasPending) return true;

    // 1. Upload creator if pending
    if (pendingCreator) {
      try {
        const result = await uploadFileToS3(pendingCreator.file, keyPrefix);
        const probe = await probeVideo(result.s3Key);

        await save({
          creatorS3Key: result.s3Key,
          creatorS3Url: result.s3Url,
          creatorDurationS: probe?.durationS ?? composition?.creatorDurationS ?? null,
          creatorWidth: probe?.width ?? composition?.creatorWidth ?? null,
          creatorHeight: probe?.height ?? composition?.creatorHeight ?? null,
        } as any);

        URL.revokeObjectURL(pendingCreator.blobUrl);
        setPendingCreator(null);
      } catch (err) {
        console.error('Creator upload failed:', err);
        toast.error('Failed to upload creator video');
        return false;
      }
    }

    // 2. Upload pending tracks
    const trackEntries = Array.from(pendingTracks.entries());
    for (const [localId, pending] of trackEntries) {
      try {
        const localTrack = composition?.tracks.find((t) => t.id === localId);
        const result = await uploadFileToS3(pending.file, keyPrefix);
        const probe = await probeVideo(result.s3Key);

        const res = await fetch(`/api/compositions/${compositionId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s3Key: result.s3Key,
            s3Url: result.s3Url,
            label: localTrack?.label || pending.file.name,
            durationS: probe?.durationS ?? localTrack?.durationS ?? 10,
            width: probe?.width ?? localTrack?.width ?? null,
            height: probe?.height ?? localTrack?.height ?? null,
            hasAudio: probe?.hasAudio ?? localTrack?.hasAudio ?? true,
            startAtS: localTrack?.startAtS ?? 0,
            trimStartS: localTrack?.trimStartS ?? 0,
            trimEndS: localTrack?.trimEndS ?? null,
          }),
        });
        if (!res.ok) throw new Error('Failed to create track');

        URL.revokeObjectURL(pending.blobUrl);
        setPendingTracks((prev) => {
          const next = new Map(prev);
          next.delete(localId);
          return next;
        });
      } catch (err) {
        console.error(`Track upload failed for ${localId}:`, err);
        toast.error('Failed to upload reference track');
        return false;
      }
    }

    // Re-fetch composition from server to get authoritative state
    await fetchComposition();
    return true;
  }, [
    compositionId,
    pendingCreator,
    pendingTracks,
    composition,
    save,
    probeVideo,
    fetchComposition,
  ]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-8">
        <Card className="border-dashed">
          <CardContent className="flex items-center justify-center py-20">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!composition) {
    return null;
  }

  const isRendering = composition.status === 'rendering';
  const completedOutputs = composition.outputs.filter(
    (o) => o.status === 'completed' && (o.s3Url || localOutputs.has(o.layout))
  );
  const hasCreatorVideo = !!pendingCreator || !!composition.creatorS3Key;
  const totalTracks = composition.tracks.length;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-4">
      {/* Back nav */}
      <Link href="/reactions" className="inline-flex">
        <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground">
          <ArrowLeft className="h-4 w-4" />
          Reactions
        </Button>
      </Link>

      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            {statusBadge(composition.status)}
            <Badge variant="secondary">{composition.mode}</Badge>
            {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </div>
          <Input
            value={composition.title}
            onChange={(e) =>
              setComposition((prev) => (prev ? { ...prev, title: e.target.value } : prev))
            }
            onBlur={() => save({ title: composition.title })}
            className="text-lg font-bold border-none shadow-none px-0 focus-visible:ring-0 h-auto"
            placeholder="Composition title"
          />
          <CardDescription>Configure and render your reaction video.</CardDescription>
        </CardHeader>
        <CardContent>
          <ModeSelector
            mode={composition.mode as 'pre-synced' | 'timeline'}
            onChange={(mode) => save({ mode })}
          />
        </CardContent>
      </Card>

      {/* Creator video */}
      <Card>
        <CardHeader>
          <CardTitle>Creator Video</CardTitle>
          <CardDescription>Your commentary footage</CardDescription>
        </CardHeader>
        <CardContent>
          {composition.creatorS3Url || pendingCreator ? (
            <div className="max-w-sm">
              <CreatorVideoPanel
                s3Url={pendingCreator?.blobUrl || composition.creatorS3Url!}
                isLocal={!!pendingCreator}
                durationS={composition.creatorDurationS ?? undefined}
                onTimeUpdate={setCurrentTime}
                onClick={
                  composition.creatorDurationS
                    ? () =>
                        setTrimTarget({
                          type: 'creator',
                          src: pendingCreator?.blobUrl || composition.creatorS3Url!,
                          durationS: composition.creatorDurationS!,
                          trimStartS: composition.creatorTrimStartS,
                          trimEndS: composition.creatorTrimEndS ?? null,
                          title: 'Trim Creator Video',
                        })
                    : undefined
                }
                deletingCreator={deletingCreator}
                onDelete={async () => {
                  if (!confirm('Delete this creator video?')) return;
                  if (pendingCreator) {
                    URL.revokeObjectURL(pendingCreator.blobUrl);
                    setPendingCreator(null);
                    setComposition((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        creatorS3Key: null,
                        creatorS3Url: null,
                        creatorDurationS: null,
                        creatorWidth: null,
                        creatorHeight: null,
                        creatorTrimStartS: 0,
                        creatorTrimEndS: null,
                      };
                    });
                    toast.success('Creator video removed');
                    return;
                  }
                  setDeletingCreator(true);
                  try {
                    await save({
                      creatorS3Key: null,
                      creatorS3Url: null,
                      creatorDurationS: null,
                      creatorWidth: null,
                      creatorHeight: null,
                      creatorTrimStartS: 0,
                      creatorTrimEndS: null,
                    } as any);
                    toast.success('Creator video removed');
                  } catch {
                    toast.error('Failed to remove creator video');
                  } finally {
                    setDeletingCreator(false);
                  }
                }}
              />
            </div>
          ) : (
            <VideoUploader
              label="Upload your commentary video"
              deferred
              onFileSelected={handleCreatorFileSelected}
              onUploaded={handleCreatorUploaded}
              keyPrefix={`compositions/${compositionId}/raw`}
            />
          )}
        </CardContent>
      </Card>

      {/* Reference tracks */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <CardTitle>Reference Clips</CardTitle>
                {totalTracks > 0 && <Badge variant="secondary">{totalTracks}/10</Badge>}
              </div>
              <CardDescription>Source videos you&#39;re reacting to</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {composition.tracks.map((track, i) => (
              <ReferenceTrackPanel
                key={track.id}
                track={track}
                index={i}
                isLocal={isLocalId(track.id)}
                mode={composition.mode as 'pre-synced' | 'timeline'}
                onUpdate={handleUpdateTrack}
                onRemove={handleRemoveTrack}
                deleting={deletingTrackId === track.id}
                disabled={isRendering}
                onClick={() =>
                  setTrimTarget({
                    type: 'reference',
                    trackId: track.id,
                    src: track.s3Url,
                    durationS: track.durationS,
                    trimStartS: track.trimStartS,
                    trimEndS: track.trimEndS,
                    title: `Trim ${track.label || `Reference ${i + 1}`}`,
                  })
                }
              />
            ))}

            {totalTracks < 10 && (
              <VideoUploader
                label="Add reference clip"
                deferred
                onFileSelected={handleTrackFileSelected}
                onUploaded={handleAddTrack}
                keyPrefix={`compositions/${compositionId}/raw`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline (only in timeline mode) */}
      {composition.mode === 'timeline' && totalTracks > 0 && composition.creatorDurationS && (
        <Card>
          <CardHeader>
            <CardTitle>Timeline</CardTitle>
          </CardHeader>
          <CardContent>
            <TimelineEditor
              tracks={composition.tracks}
              creatorDurationS={composition.creatorDurationS}
              currentTime={currentTime}
              onTrackMove={handleTrackMove}
            />
          </CardContent>
        </Card>
      )}

      {/* Audio mix */}
      <Card>
        <CardHeader>
          <CardTitle>Audio Mixing</CardTitle>
        </CardHeader>
        <CardContent>
          <AudioMixPanel
            audioMode={composition.audioMode as 'creator' | 'reference' | 'both'}
            creatorVolume={composition.creatorVolume}
            referenceVolume={composition.referenceVolume}
            onAudioModeChange={(audioMode) => save({ audioMode })}
            onCreatorVolumeChange={(creatorVolume) => save({ creatorVolume })}
            onReferenceVolumeChange={(referenceVolume) => save({ referenceVolume })}
          />
        </CardContent>
      </Card>

      {/* Render controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle>Output</CardTitle>
            {completedOutputs.length > 1 && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setPublishAllOpen(true)}
              >
                <Share2 className="h-3 w-3" />
                Publish All
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          <RenderControls
            compositionId={compositionId}
            compositionStatus={composition.status}
            outputs={composition.outputs}
            hasCreator={hasCreatorVideo}
            hasTracks={totalTracks > 0}
            hasPortraitRef={composition.tracks.some(
              (t) => t.width != null && t.height != null && t.height > t.width
            )}
            hasLandscapeRef={composition.tracks.some(
              (t) => t.width == null || t.height == null || t.width >= t.height
            )}
            autoLayouts={detectOutputLayouts()}
            onStatusChange={handleStatusChange}
            compositionTitle={composition.title}
            trackLabels={composition.tracks.map((t) => t.label || '').filter(Boolean)}
            onBeforeRender={handleBeforeRender}
            localOutputs={localOutputs}
            onLocalOutputsChange={setLocalOutputs}
          />
        </CardContent>
      </Card>

      {/* Thumbnail Builder */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <CardTitle>Thumbnail Builder</CardTitle>
              <CardDescription>
                {isRendering
                  ? 'Thumbnails will be generated after render completes.'
                  : 'Choose a background, cutout, position, and size.'}
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-xs"
              onClick={() => thumbnailRegenerateRef.current?.()}
              disabled={thumbnailGenerating || isRendering}
            >
              {thumbnailGenerating ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <RefreshCw className="h-3 w-3" />
              )}
              Regenerate
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ThumbnailPanel
            compositionId={compositionId}
            compositionStatus={composition.status}
            hideHeader
            onGeneratingChange={setThumbnailGenerating}
            regenerateRef={thumbnailRegenerateRef}
          />
        </CardContent>
      </Card>

      {/* Publish all modal */}
      <PublishModal
        open={publishAllOpen}
        onOpenChange={setPublishAllOpen}
        mediaItems={completedOutputs.map((o) => {
          const lo = localOutputs.get(o.layout);
          return {
            url: lo?.blobUrl || o.s3Url!,
            label: o.layout,
          };
        })}
        generationContext={{
          title: composition.title,
          trackLabels: composition.tracks.map((t) => t.label || '').filter(Boolean),
          layouts: completedOutputs.map((o) => o.layout),
          transcript: completedOutputs.find((o) => o.transcript)?.transcript || undefined,
        }}
      />

      {/* Trim modal */}
      {trimTarget && (
        <TrimModal
          open={!!trimTarget}
          onOpenChange={(open) => {
            if (!open) setTrimTarget(null);
          }}
          videoSrc={trimTarget.src}
          durationS={trimTarget.durationS}
          trimStartS={trimTarget.trimStartS}
          trimEndS={trimTarget.trimEndS}
          onSave={handleTrimSave}
          title={trimTarget.title}
        />
      )}
    </div>
  );
}
