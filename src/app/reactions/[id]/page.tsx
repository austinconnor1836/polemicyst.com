'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2, RefreshCw, Scissors, Share2, X } from 'lucide-react';
import { ModeSelector } from '../_components/ModeSelector';
import { VideoUploader, type UploadStatus } from '../_components/VideoUploader';
import { CreatorVideoPanel } from '../_components/CreatorVideoPanel';
import { ReferenceTrackPanel } from '../_components/ReferenceTrackPanel';
import { TimelineEditor } from '../_components/TimelineEditor';
import { AudioMixPanel } from '../_components/AudioMixPanel';
import { RenderControls } from '../_components/RenderControls';
import { ThumbnailPanel } from '../_components/ThumbnailPanel';
import { TrimModal } from '../_components/TrimModal';
import { CutModal, type CompositionCut } from '../_components/CutModal';
import { PublishModal } from '@/components/PublishModal';
import { supportsClientRender } from '@/lib/client-render';
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
  cuts?: CompositionCut[] | null;
  tracks: Track[];
  outputs: Output[];
}

/**
 * Always render both mobile (9:16) and landscape (16:9) outputs.
 */
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

function formatTimeShort(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

function formatCutLabel(cut: CompositionCut, tracks: Track[]): string {
  const time = `${formatTimeShort(cut.startS)}–${formatTimeShort(cut.endS)}`;
  const targetLabels = cut.targets.map((t) => {
    if (t === 'creator') return 'Creator';
    const track = tracks.find((tr) => tr.id === t);
    return track?.label || 'Ref';
  });
  if (targetLabels.length === tracks.length + 1) return `${time} (All)`;
  return `${time} (${targetLabels.join(', ')})`;
}

export default function CompositionEditorPage() {
  const params = useParams();
  const router = useRouter();
  const compositionId = params.id as string;

  const [composition, setComposition] = useState<Composition | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [addingTrack, setAddingTrack] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [deletingCreator, setDeletingCreator] = useState(false);
  const [deletingTrackId, setDeletingTrackId] = useState<string | null>(null);
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [thumbnailGenerating, setThumbnailGenerating] = useState(false);
  const thumbnailRegenerateRef = useRef<(() => void) | null>(null);
  const [cutModalOpen, setCutModalOpen] = useState(false);
  const [trimTarget, setTrimTarget] = useState<{
    type: 'creator' | 'reference';
    trackId?: string;
    src: string;
    durationS: number;
    trimStartS: number;
    trimEndS: number | null;
    title: string;
  } | null>(null);

  // Background upload state — creator video
  const [creatorBlobUrl, setCreatorBlobUrl] = useState<string | null>(null);
  const [creatorUploadStatus, setCreatorUploadStatus] = useState<UploadStatus>('idle');
  const [creatorUploadProgress, setCreatorUploadProgress] = useState<number | null>(null);
  const [creatorUploadSpeed, setCreatorUploadSpeed] = useState<number | null>(null);
  const [creatorLocalMeta, setCreatorLocalMeta] = useState<{
    durationS: number;
    width: number;
    height: number;
  } | null>(null);

  // Background upload state — reference track
  const [pendingRefBlobUrl, setPendingRefBlobUrl] = useState<string | null>(null);
  const [pendingRefMeta, setPendingRefMeta] = useState<{
    filename: string;
    durationS: number;
    width: number;
    height: number;
  } | null>(null);
  const [refUploadStatus, setRefUploadStatus] = useState<UploadStatus>('idle');
  const [refUploadProgress, setRefUploadProgress] = useState<number | null>(null);
  const [refUploadSpeed, setRefUploadSpeed] = useState<number | null>(null);

  // Client-side rendering: store raw File objects for WebCodecs demuxer
  const useClientRender = supportsClientRender();
  const [creatorFile, setCreatorFile] = useState<File | null>(null);
  const [refFiles, setRefFiles] = useState<Map<string, File>>(new Map());

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
    } catch (err) {
      toast.error('Failed to load composition');
    } finally {
      setLoading(false);
    }
  }, [compositionId, router]);

  useEffect(() => {
    fetchComposition();
  }, [fetchComposition]);

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
      } catch (err) {
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

  // --- Non-blocking creator upload handlers ---
  const handleCreatorFileSelected = useCallback(
    (data: {
      blobUrl: string;
      file: File;
      filename: string;
      fileSize: number;
      durationS: number;
      width: number;
      height: number;
    }) => {
      setCreatorBlobUrl(data.blobUrl);
      setCreatorFile(data.file);
      setCreatorLocalMeta({ durationS: data.durationS, width: data.width, height: data.height });
      if (useClientRender) {
        // Client-render mode: no upload needed, mark complete immediately
        setCreatorUploadStatus('complete');
      } else {
        setCreatorUploadStatus('uploading');
      }
      setCreatorUploadProgress(null);
      // Update local composition state immediately so trim/timeline works
      setComposition((prev) =>
        prev
          ? {
              ...prev,
              creatorDurationS: data.durationS,
              creatorWidth: data.width,
              creatorHeight: data.height,
            }
          : prev
      );
    },
    [useClientRender]
  );

  const handleCreatorUploadComplete = useCallback(
    async (data: { s3Key: string; s3Url: string }) => {
      setCreatorUploadStatus('complete');
      // Server probe for accuracy (hasAudio, precise duration)
      const probe = await probeVideo(data.s3Key);
      await save({
        creatorS3Key: data.s3Key,
        creatorS3Url: data.s3Url,
        creatorDurationS: probe?.durationS ?? creatorLocalMeta?.durationS ?? null,
        creatorWidth: probe?.width ?? creatorLocalMeta?.width ?? null,
        creatorHeight: probe?.height ?? creatorLocalMeta?.height ?? null,
      } as any);
      // Revoke blob URL and switch to CreatorVideoPanel
      if (creatorBlobUrl) URL.revokeObjectURL(creatorBlobUrl);
      setCreatorBlobUrl(null);
      setCreatorUploadStatus('idle');
    },
    [save, probeVideo, creatorLocalMeta, creatorBlobUrl]
  );

  // --- Non-blocking reference track upload handlers ---
  const handleRefFileSelected = useCallback(
    (data: {
      blobUrl: string;
      file: File;
      filename: string;
      fileSize: number;
      durationS: number;
      width: number;
      height: number;
    }) => {
      setPendingRefBlobUrl(data.blobUrl);
      setPendingRefMeta({
        filename: data.filename,
        durationS: data.durationS,
        width: data.width,
        height: data.height,
      });
      if (useClientRender) {
        // Client-render mode: create a local track immediately instead of uploading
        setRefUploadStatus('complete');
        // Generate a temporary track ID and add to composition locally
        const tempId = `local_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        setRefFiles((prev) => new Map(prev).set(tempId, data.file));
        setComposition((prev) => {
          if (!prev) return prev;
          const newTrack: Track = {
            id: tempId,
            label: data.filename,
            s3Key: '',
            s3Url: data.blobUrl,
            durationS: data.durationS,
            width: data.width,
            height: data.height,
            startAtS: 0,
            trimStartS: 0,
            trimEndS: null,
            sortOrder: prev.tracks.length,
            hasAudio: true, // assume true; no server probe in local mode
          };
          return { ...prev, tracks: [...prev.tracks, newTrack] };
        });
        // Clean up pending ref state
        setPendingRefBlobUrl(null);
        setPendingRefMeta(null);
        setRefUploadStatus('idle');
        toast.success('Reference track added');
      } else {
        setRefUploadStatus('uploading');
      }
      setRefUploadProgress(null);
    },
    [useClientRender]
  );

  const handleRefUploadComplete = useCallback(
    async (data: { s3Key: string; s3Url: string }) => {
      setRefUploadStatus('complete');
      setAddingTrack(true);
      try {
        const probe = await probeVideo(data.s3Key);
        const res = await fetch(`/api/compositions/${compositionId}/tracks`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            s3Key: data.s3Key,
            s3Url: data.s3Url,
            label: pendingRefMeta?.filename ?? 'Reference',
            durationS: probe?.durationS ?? pendingRefMeta?.durationS ?? 10,
            width: probe?.width ?? pendingRefMeta?.width ?? null,
            height: probe?.height ?? pendingRefMeta?.height ?? null,
            hasAudio: probe?.hasAudio ?? true,
          }),
        });
        if (!res.ok) throw new Error('Failed to add track');
        await fetchComposition();
        toast.success('Reference track added');
      } catch (err) {
        toast.error('Failed to add track');
      } finally {
        if (pendingRefBlobUrl) URL.revokeObjectURL(pendingRefBlobUrl);
        setPendingRefBlobUrl(null);
        setPendingRefMeta(null);
        setRefUploadStatus('idle');
        setAddingTrack(false);
      }
    },
    [compositionId, fetchComposition, probeVideo, pendingRefMeta, pendingRefBlobUrl]
  );

  const handleUpdateTrack = useCallback(
    async (trackId: string, data: Partial<Track>) => {
      try {
        const res = await fetch(`/api/compositions/${compositionId}/tracks/${trackId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Failed to update track');
        // Update local state optimistically
        setComposition((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            tracks: prev.tracks.map((t) => (t.id === trackId ? { ...t, ...data } : t)),
          };
        });
      } catch (err) {
        toast.error('Failed to update track');
      }
    },
    [compositionId]
  );

  const handleRemoveTrack = useCallback(
    async (trackId: string) => {
      if (!confirm('Remove this reference track?')) return;
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
      } catch (err) {
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
        await save({ creatorTrimStartS: trimStartS, creatorTrimEndS: trimEndS } as any);
        toast.success('Creator trim updated');
      } else if (trimTarget.trackId) {
        await handleUpdateTrack(trimTarget.trackId, { trimStartS, trimEndS });
        toast.success('Track trim updated');
      }
      setTrimTarget(null);
    },
    [trimTarget, save, handleUpdateTrack]
  );

  const handleCutSave = useCallback(
    async (cut: { startS: number; endS: number; targets: string[] }) => {
      const existingCuts: CompositionCut[] = composition?.cuts ?? [];
      const newCut: CompositionCut = {
        id: `cut_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        ...cut,
      };
      const updated = [...existingCuts, newCut].sort((a, b) => a.startS - b.startS);
      await save({ cuts: updated } as any);
      toast.success('Cut added');
    },
    [composition, save]
  );

  const handleCutDelete = useCallback(
    async (cutId: string) => {
      if (!confirm('Remove this cut?')) return;
      const existingCuts: CompositionCut[] = composition?.cuts ?? [];
      const updated = existingCuts.filter((c) => c.id !== cutId);
      await save({ cuts: updated.length > 0 ? updated : null } as any);
      toast.success('Cut removed');
    },
    [composition, save]
  );

  // Compute effective output duration (post-trim, post-cuts)
  const effectiveOutputDuration = (() => {
    if (!composition?.creatorDurationS) return 0;
    const trimEnd = composition.creatorTrimEndS ?? composition.creatorDurationS;
    let dur = trimEnd - composition.creatorTrimStartS;
    for (const cut of composition.cuts ?? []) {
      dur -= cut.endS - cut.startS;
    }
    return Math.max(0, dur);
  })();

  // Build available cut targets
  const cutTargets = (() => {
    if (!composition) return [];
    const targets: Array<{ id: string; label: string }> = [];
    if (composition.creatorS3Url || creatorBlobUrl) {
      targets.push({ id: 'creator', label: 'Creator' });
    }
    composition.tracks.forEach((track, i) => {
      targets.push({ id: track.id, label: track.label || `Reference ${i + 1}` });
    });
    return targets;
  })();

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
  const completedOutputs = composition.outputs.filter((o) => o.status === 'completed' && o.s3Url);

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
          {composition.creatorS3Url && !creatorBlobUrl ? (
            <div className="max-w-sm">
              <CreatorVideoPanel
                s3Url={composition.creatorS3Url}
                durationS={composition.creatorDurationS ?? undefined}
                onTimeUpdate={setCurrentTime}
                onClick={
                  composition.creatorDurationS
                    ? () =>
                        setTrimTarget({
                          type: 'creator',
                          src: composition.creatorS3Url!,
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
            <div className="max-w-sm space-y-2">
              <VideoUploader
                label={
                  useClientRender ? 'Add your commentary video' : 'Upload your commentary video'
                }
                blobUrl={creatorBlobUrl}
                uploadStatus={creatorUploadStatus}
                uploadProgress={creatorUploadProgress}
                uploadSpeed={creatorUploadSpeed}
                localOnly={useClientRender}
                onFileSelected={handleCreatorFileSelected}
                onUploadComplete={handleCreatorUploadComplete}
                onUploadProgress={(p, s) => {
                  setCreatorUploadProgress(p);
                  setCreatorUploadSpeed(s);
                }}
                onUploadError={(msg) => {
                  setCreatorUploadStatus('error');
                  toast.error(msg);
                }}
                onRemove={
                  creatorBlobUrl
                    ? () => {
                        if (creatorBlobUrl) URL.revokeObjectURL(creatorBlobUrl);
                        setCreatorBlobUrl(null);
                        setCreatorFile(null);
                        setCreatorLocalMeta(null);
                        setCreatorUploadStatus('idle');
                        setComposition((prev) =>
                          prev
                            ? {
                                ...prev,
                                creatorDurationS: null,
                                creatorWidth: null,
                                creatorHeight: null,
                              }
                            : prev
                        );
                      }
                    : undefined
                }
                keyPrefix={`compositions/${compositionId}/raw`}
              />
              {/* Trim available during upload */}
              {creatorBlobUrl && creatorLocalMeta && creatorLocalMeta.durationS > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1 text-xs"
                  onClick={() =>
                    setTrimTarget({
                      type: 'creator',
                      src: creatorBlobUrl,
                      durationS: creatorLocalMeta.durationS,
                      trimStartS: composition.creatorTrimStartS,
                      trimEndS: composition.creatorTrimEndS ?? null,
                      title: 'Trim Creator Video',
                    })
                  }
                >
                  <Scissors className="h-3 w-3" />
                  Trim
                </Button>
              )}
            </div>
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
                {composition.tracks.length > 0 && (
                  <Badge variant="secondary">{composition.tracks.length}/10</Badge>
                )}
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

            {composition.tracks.length < 10 && (
              <VideoUploader
                label={addingTrack ? 'Adding track...' : 'Add reference clip'}
                blobUrl={pendingRefBlobUrl}
                uploadStatus={refUploadStatus}
                uploadProgress={refUploadProgress}
                uploadSpeed={refUploadSpeed}
                localOnly={useClientRender}
                onFileSelected={handleRefFileSelected}
                onUploadComplete={handleRefUploadComplete}
                onUploadProgress={(p, s) => {
                  setRefUploadProgress(p);
                  setRefUploadSpeed(s);
                }}
                onUploadError={(msg) => {
                  setRefUploadStatus('error');
                  toast.error(msg);
                }}
                className={addingTrack ? 'pointer-events-none opacity-50' : ''}
                keyPrefix={`compositions/${compositionId}/raw`}
              />
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline (only in timeline mode) */}
      {composition.mode === 'timeline' &&
        composition.tracks.length > 0 &&
        composition.creatorDurationS && (
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
                cuts={composition.cuts ?? undefined}
              />
            </CardContent>
          </Card>
        )}

      {/* Cuts */}
      {composition.creatorDurationS && composition.creatorDurationS > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <CardTitle>Cuts</CardTitle>
                <CardDescription>Remove unwanted sections from the output</CardDescription>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1 text-xs"
                onClick={() => setCutModalOpen(true)}
                disabled={isRendering}
              >
                <Scissors className="h-3 w-3" />
                Add Cut
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {composition.cuts && composition.cuts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {composition.cuts.map((cut) => (
                  <Badge
                    key={cut.id}
                    variant="secondary"
                    className="gap-1 pl-2 pr-1 py-1 bg-red-50 text-red-700 border-red-200 dark:bg-red-950/30 dark:text-red-300 dark:border-red-800"
                  >
                    {formatCutLabel(cut, composition.tracks)}
                    <button
                      onClick={() => handleCutDelete(cut.id)}
                      className="ml-1 rounded-sm p-0.5 hover:bg-red-200 dark:hover:bg-red-800 transition-colors"
                      disabled={isRendering}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">
                No cuts yet. Click &quot;Add Cut&quot; to remove a section.
              </p>
            )}
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
            hasCreator={!!(composition.creatorS3Key || creatorBlobUrl)}
            hasTracks={composition.tracks.length > 0}
            uploadsInProgress={
              creatorUploadStatus === 'uploading' || refUploadStatus === 'uploading'
            }
            uploadProgress={Math.max(creatorUploadProgress ?? 0, refUploadProgress ?? 0)}
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
            // Client-side render props
            creatorFile={creatorFile}
            refFiles={refFiles}
            composition={composition}
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
        mediaItems={completedOutputs.map((o) => ({
          url: o.s3Url!,
          label: o.layout,
        }))}
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

      {/* Cut modal */}
      {(composition.creatorS3Url || creatorBlobUrl) && composition.creatorDurationS && (
        <CutModal
          open={cutModalOpen}
          onOpenChange={setCutModalOpen}
          videoSrc={(composition.creatorS3Url || creatorBlobUrl)!}
          durationS={effectiveOutputDuration}
          existingCuts={composition.cuts ?? []}
          availableTargets={cutTargets}
          onSave={handleCutSave}
        />
      )}
    </div>
  );
}
