'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Loader2, Share2 } from 'lucide-react';
import { ModeSelector } from '../_components/ModeSelector';
import { VideoUploader } from '../_components/VideoUploader';
import { CreatorVideoPanel } from '../_components/CreatorVideoPanel';
import { ReferenceTrackPanel } from '../_components/ReferenceTrackPanel';
import { TimelineEditor } from '../_components/TimelineEditor';
import { AudioMixPanel } from '../_components/AudioMixPanel';
import { RenderControls } from '../_components/RenderControls';
import { ThumbnailPanel } from '../_components/ThumbnailPanel';
import { TrimModal } from '../_components/TrimModal';
import { PublishModal } from '@/components/PublishModal';
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

/**
 * Always render both mobile (9:16) and landscape (16:9) outputs.
 */
function detectOutputLayouts(): ('mobile' | 'landscape')[] {
  return ['mobile', 'landscape'];
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
  const [publishAllOpen, setPublishAllOpen] = useState(false);
  const [trimTarget, setTrimTarget] = useState<{
    type: 'creator' | 'reference';
    trackId?: string;
    src: string;
    durationS: number;
    trimStartS: number;
    trimEndS: number | null;
    title: string;
  } | null>(null);

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

  const handleAddTrack = useCallback(
    async (data: { s3Key: string; s3Url: string; filename: string }) => {
      setAddingTrack(true);
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
      } catch (err) {
        toast.error('Failed to add track');
      } finally {
        setAddingTrack(false);
      }
    },
    [compositionId, fetchComposition, probeVideo]
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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!composition) {
    return null;
  }

  const isRendering = composition.status === 'rendering';
  const completedOutputs = composition.outputs.filter((o) => o.status === 'completed' && o.s3Url);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link href="/reactions">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <Input
            value={composition.title}
            onChange={(e) =>
              setComposition((prev) => (prev ? { ...prev, title: e.target.value } : prev))
            }
            onBlur={() => save({ title: composition.title })}
            className="text-lg font-bold border-none shadow-none px-0 focus-visible:ring-0"
            placeholder="Composition title"
          />
        </div>
        {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {/* Mode selector */}
      <div>
        <Label className="mb-2 block">Composition Mode</Label>
        <ModeSelector
          mode={composition.mode as 'pre-synced' | 'timeline'}
          onChange={(mode) => save({ mode })}
        />
      </div>

      {/* Creator video */}
      <div>
        <Label className="mb-2 block">Creator Video (your commentary)</Label>
        {composition.creatorS3Url ? (
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
          <VideoUploader
            label="Upload your commentary video"
            onUploaded={handleCreatorUploaded}
            keyPrefix={`compositions/${compositionId}/raw`}
          />
        )}
      </div>

      {/* Reference tracks */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <Label>Reference Clips</Label>
          {composition.tracks.length < 10 && (
            <span className="text-xs text-muted-foreground">
              {composition.tracks.length}/10 tracks
            </span>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {composition.tracks.map((track, i) => (
            <ReferenceTrackPanel
              key={track.id}
              track={track}
              index={i}
              mode={composition.mode as 'pre-synced' | 'timeline'}
              onUpdate={handleUpdateTrack}
              onRemove={handleRemoveTrack}
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
              onUploaded={handleAddTrack}
              className={addingTrack ? 'pointer-events-none opacity-50' : ''}
              keyPrefix={`compositions/${compositionId}/raw`}
            />
          )}
        </div>
      </div>

      {/* Timeline (only in timeline mode) */}
      {composition.mode === 'timeline' &&
        composition.tracks.length > 0 &&
        composition.creatorDurationS && (
          <TimelineEditor
            tracks={composition.tracks}
            creatorDurationS={composition.creatorDurationS}
            currentTime={currentTime}
            onTrackMove={handleTrackMove}
          />
        )}

      {/* Audio mix */}
      <AudioMixPanel
        audioMode={composition.audioMode as 'creator' | 'reference' | 'both'}
        creatorVolume={composition.creatorVolume}
        referenceVolume={composition.referenceVolume}
        onAudioModeChange={(audioMode) => save({ audioMode })}
        onCreatorVolumeChange={(creatorVolume) => save({ creatorVolume })}
        onReferenceVolumeChange={(referenceVolume) => save({ referenceVolume })}
      />

      {/* Render controls */}
      <div>
        <div className="mb-2 flex items-center justify-between">
          <Label>Output</Label>
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
        <RenderControls
          compositionId={compositionId}
          compositionStatus={composition.status}
          outputs={composition.outputs}
          hasCreator={!!composition.creatorS3Key}
          hasTracks={composition.tracks.length > 0}
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
        />
      </div>

      {/* Thumbnails */}
      <ThumbnailPanel compositionId={compositionId} compositionStatus={composition.status} />

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
    </div>
  );
}
