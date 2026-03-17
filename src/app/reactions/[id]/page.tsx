'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ArrowLeft, Plus, Loader2, Save } from 'lucide-react';
import { ModeSelector } from '../_components/ModeSelector';
import { VideoUploader } from '../_components/VideoUploader';
import { CreatorVideoPanel } from '../_components/CreatorVideoPanel';
import { ReferenceTrackPanel } from '../_components/ReferenceTrackPanel';
import { TimelineEditor } from '../_components/TimelineEditor';
import { AudioMixPanel } from '../_components/AudioMixPanel';
import { RenderControls } from '../_components/RenderControls';
import { LayoutPreview } from '../_components/LayoutPreview';
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
  tracks: Track[];
  outputs: Output[];
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
          <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
            <div>
              <CreatorVideoPanel
                s3Url={composition.creatorS3Url}
                durationS={composition.creatorDurationS ?? undefined}
                onTimeUpdate={setCurrentTime}
              />
              {composition.creatorS3Key && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1 text-xs text-muted-foreground"
                  onClick={() =>
                    save({ creatorS3Key: null, creatorS3Url: null, creatorDurationS: null } as any)
                  }
                >
                  Replace creator video
                </Button>
              )}
            </div>
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

        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
          {composition.tracks.map((track, i) => (
            <ReferenceTrackPanel
              key={track.id}
              track={track}
              index={i}
              mode={composition.mode as 'pre-synced' | 'timeline'}
              onUpdate={handleUpdateTrack}
              onRemove={handleRemoveTrack}
              disabled={isRendering}
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

      {/* DEBUG: All LayoutPreview states */}
      <div className="rounded-lg border border-dashed border-yellow-500 p-4 space-y-4 bg-yellow-50/50 dark:bg-yellow-900/10">
        <Label className="text-yellow-700 dark:text-yellow-400 font-bold">
          DEBUG: All LayoutPreview States
        </Label>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-6">
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Mobile — No Reference</span>
            <LayoutPreview
              layout="mobile"
              hasReference={false}
              hasPortraitRef={false}
              hasLandscapeRef={false}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Mobile — With Reference
            </span>
            <LayoutPreview
              layout="mobile"
              hasReference={true}
              hasPortraitRef={true}
              hasLandscapeRef={false}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Landscape — No Reference
            </span>
            <LayoutPreview
              layout="landscape"
              hasReference={false}
              hasPortraitRef={false}
              hasLandscapeRef={false}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Landscape — Landscape Ref Only
            </span>
            <LayoutPreview
              layout="landscape"
              hasReference={true}
              hasPortraitRef={false}
              hasLandscapeRef={true}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Landscape — Portrait Ref Only
            </span>
            <LayoutPreview
              layout="landscape"
              hasReference={true}
              hasPortraitRef={true}
              hasLandscapeRef={false}
            />
          </div>
          <div className="space-y-1">
            <span className="text-xs font-medium text-muted-foreground">
              Landscape — Both Ref Types
            </span>
            <LayoutPreview
              layout="landscape"
              hasReference={true}
              hasPortraitRef={true}
              hasLandscapeRef={true}
            />
          </div>
        </div>
      </div>

      {/* Render controls */}
      <div>
        <Label className="mb-2 block">Output</Label>
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
          onStatusChange={handleStatusChange}
        />
      </div>
    </div>
  );
}
