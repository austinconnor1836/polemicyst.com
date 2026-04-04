'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, Loader2, RefreshCw, Scissors, Share2, Wand2, X } from 'lucide-react';
import { ModeSelector } from '../_components/ModeSelector';
import { VideoUploader, type UploadStatus } from '../_components/VideoUploader';
import { CompositionVideoPanel } from '../_components/CompositionVideoPanel';
import { TimelineEditor } from '../_components/TimelineEditor';
import { RenderControls } from '../_components/RenderControls';
import { ThumbnailPanel } from '../_components/ThumbnailPanel';
import { TrimModal } from '../_components/TrimModal';
import { EditOutputModal, type CompositionCut } from '../_components/EditOutputModal';
import { VideoPublishModal } from '@/components/VideoPublishModal';
import { supportsClientRender } from '@/lib/client-render';
import {
  saveBlobToCache,
  loadBlobsFromCache,
  saveCreatorFileToCache,
  loadCreatorFileFromCache,
  clearCreatorFileCache,
  saveRefFileToCache,
  loadRefFilesFromCache,
  clearRefFileCache,
} from '@/lib/client-render/blob-cache';
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
  transcriptJson?: Array<{ start: number; end: number; text: string }> | null;
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

interface AutoEditSummary {
  silenceCuts: number;
  badTakeCuts: number;
  totalCuts: number;
  totalRemovedS: number;
  originalDurationS: number;
  newDurationS: number;
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
  creatorTranscriptJson?: Array<{ start: number; end: number; text: string }> | null;
  cuts?: CompositionCut[] | null;
  silenceRegions?: Array<{ startS: number; endS: number }> | null;
  autoEditResult?: { cuts: any[]; summary: AutoEditSummary } | null;
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
  const [thumbnailCompositeUrl, setThumbnailCompositeUrl] = useState<string | null>(null);
  const thumbnailRegenerateRef = useRef<(() => void) | null>(null);
  const uploadOutputRef = useRef<((layout: string) => Promise<void>) | null>(null);
  const [uploadingLayout, setUploadingLayout] = useState<string | null>(null);
  const [editOutputOpen, setEditOutputOpen] = useState(false);
  const [autoEditing, setAutoEditing] = useState(false);
  const [autoEditCuts, setAutoEditCuts] = useState<CompositionCut[] | undefined>(undefined);
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

  // Client-rendered output blobs (lifted from RenderControls for EditOutputModal access)
  const [clientOutputBlobs, setClientOutputBlobs] = useState<Map<string, Blob>>(new Map());
  const [clientOutputUrls, setClientOutputUrls] = useState<Map<string, string>>(new Map());

  // Client-render transcription state
  const [transcriptionStatus, setTranscriptionStatus] = useState<
    'idle' | 'transcribing' | 'complete' | 'error'
  >('idle');

  // Caption settings from user automation config
  const [captionsEnabled, setCaptionsEnabled] = useState(false);
  const [captionFontSizePx, setCaptionFontSizePx] = useState(36);

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
      setComposition((prev) => {
        if (!prev) return data;
        // Preserve client-rendered blob URLs and local tracks across refetches
        const localTracks = prev.tracks.filter((t) => t.id.startsWith('local_'));
        const mergedOutputs = (data.outputs || []).map((o: Output) => {
          const prevOutput = prev.outputs.find((po) => po.layout === o.layout);
          if (!o.s3Url && prevOutput?.s3Url?.startsWith('blob:')) {
            return { ...o, s3Url: prevOutput.s3Url, status: prevOutput.status };
          }
          return o;
        });
        return {
          ...data,
          tracks: [...(data.tracks || []), ...localTracks],
          outputs: mergedOutputs.length > 0 ? mergedOutputs : prev.outputs,
          creatorDurationS: data.creatorDurationS ?? prev.creatorDurationS,
          creatorWidth: data.creatorWidth ?? prev.creatorWidth,
          creatorHeight: data.creatorHeight ?? prev.creatorHeight,
        };
      });
    } catch (err) {
      toast.error('Failed to load composition');
    } finally {
      setLoading(false);
    }
  }, [compositionId, router]);

  useEffect(() => {
    fetchComposition();
  }, [fetchComposition]);

  // Fetch caption settings from user automation config
  useEffect(() => {
    fetch('/api/user/automation')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!data) return;
        setCaptionsEnabled(data.captionsEnabled ?? false);
        const vs = data.viralitySettings;
        if (vs?.captionFontSize) {
          const sizes: Record<string, number> = {
            small: 24,
            medium: 36,
            large: 48,
            xlarge: 64,
          };
          setCaptionFontSizePx(sizes[vs.captionFontSize] ?? 36);
        }
      })
      .catch(() => {
        // Non-fatal — defaults already set
      });
  }, []);

  // Restore cached rendered blobs from IndexedDB on mount
  // Must wait for composition to load so the setComposition functional update
  // has a non-null prev (otherwise it races with fetchComposition and gets skipped).
  const blobRestoreRanRef = useRef(false);
  useEffect(() => {
    if (!composition || blobRestoreRanRef.current) return;
    blobRestoreRanRef.current = true;
    const layouts = ['mobile', 'landscape'];
    loadBlobsFromCache(compositionId, layouts).then((cached) => {
      if (cached.size === 0) return;
      const newBlobs = new Map<string, Blob>();
      const newUrls = new Map<string, string>();
      cached.forEach((blob, layout) => {
        newBlobs.set(layout, blob);
        newUrls.set(layout, URL.createObjectURL(blob));
      });
      setClientOutputBlobs(newBlobs);
      setClientOutputUrls(newUrls);
      // Update outputs so video cards show cached versions
      setComposition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          status: prev.status === 'draft' ? 'completed' : prev.status,
          outputs:
            prev.outputs.length > 0
              ? prev.outputs.map((o) => {
                  const cachedUrl = newUrls.get(o.layout);
                  return cachedUrl ? { ...o, s3Url: cachedUrl, status: 'completed' } : o;
                })
              : Array.from(newUrls.entries()).map(([layout, url]) => ({
                  id: `cached_${layout}`,
                  layout,
                  status: 'completed',
                  s3Url: url,
                })),
        };
      });
      console.log(`[page] Restored ${cached.size} cached output(s) from IndexedDB`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, compositionId]);

  // Restore cached source files (creator + reference) from IndexedDB on mount
  const fileRestoreRanRef = useRef(false);
  useEffect(() => {
    if (!composition || !useClientRender || fileRestoreRanRef.current) return;
    fileRestoreRanRef.current = true;

    // Restore creator file
    loadCreatorFileFromCache(compositionId).then((cached) => {
      if (!cached) return;
      const file = new File([cached.blob], cached.name, {
        type: cached.type,
        lastModified: cached.lastModified,
      });
      const blobUrl = URL.createObjectURL(cached.blob);
      setCreatorFile(file);
      setCreatorBlobUrl(blobUrl);
      setCreatorLocalMeta({
        durationS: cached.durationS,
        width: cached.width,
        height: cached.height,
      });
      setCreatorUploadStatus('complete');
      setComposition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          creatorDurationS: cached.durationS,
          creatorWidth: cached.width,
          creatorHeight: cached.height,
        };
      });
      console.log('[page] Restored creator file from IndexedDB');
    });

    // Restore reference files
    loadRefFilesFromCache(compositionId).then((cached) => {
      if (cached.size === 0) return;
      const newRefFiles = new Map<string, File>();
      const newTracks: Track[] = [];
      cached.forEach((entry) => {
        const file = new File([entry.blob], entry.name, {
          type: entry.type,
          lastModified: entry.lastModified,
        });
        const blobUrl = URL.createObjectURL(entry.blob);
        newRefFiles.set(entry.trackId, file);
        newTracks.push({
          id: entry.trackId,
          label: entry.label,
          s3Key: '',
          s3Url: blobUrl,
          durationS: entry.durationS,
          width: entry.width,
          height: entry.height,
          startAtS: 0,
          trimStartS: 0,
          trimEndS: null,
          sortOrder: 0,
          hasAudio: true,
        });
      });
      setRefFiles((prev) => {
        const merged = new Map(prev);
        newRefFiles.forEach((f, id) => merged.set(id, f));
        return merged;
      });
      setComposition((prev) => {
        if (!prev) return prev;
        // Only add tracks whose IDs aren't already present
        const existingIds = new Set(prev.tracks.map((t) => t.id));
        const toAdd = newTracks
          .filter((t) => !existingIds.has(t.id))
          .map((t, i) => ({ ...t, sortOrder: prev.tracks.length + i }));
        return toAdd.length > 0 ? { ...prev, tracks: [...prev.tracks, ...toAdd] } : prev;
      });
      console.log(`[page] Restored ${cached.size} ref file(s) from IndexedDB`);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [composition, useClientRender, compositionId]);

  // Transcript polling: poll for transcript + auto-edit results when creator or tracks are missing transcripts
  const tracksNeedTranscript = composition?.tracks.some(
    (t) => !t.id.startsWith('local_') && t.s3Url && !t.transcriptJson
  );
  useEffect(() => {
    const creatorNeedsPoll = composition?.creatorS3Url && !composition.creatorTranscriptJson;
    const needsPoll = (creatorNeedsPoll || tracksNeedTranscript) && !loading;
    if (!needsPoll) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/compositions/${compositionId}`);
        if (!res.ok) return;
        const data = await res.json();

        const creatorDone = !data.creatorS3Url || data.creatorTranscriptJson;
        const tracksDone = !(data.tracks || []).some(
          (t: Track) => !t.id.startsWith('local_') && t.s3Url && !t.transcriptJson
        );

        if (creatorDone || tracksDone) {
          // At least one side finished — update state
          setComposition((prev) => {
            if (!prev) return data;
            const localTracks = prev.tracks.filter((t) => t.id.startsWith('local_'));
            // Preserve client-rendered blob URLs that the API doesn't know about
            const mergedOutputs = (data.outputs || []).map((o: Output) => {
              const prevOutput = prev.outputs.find((po) => po.layout === o.layout);
              if (!o.s3Url && prevOutput?.s3Url?.startsWith('blob:')) {
                return { ...o, s3Url: prevOutput.s3Url, status: prevOutput.status };
              }
              return o;
            });
            return {
              ...data,
              tracks: [...(data.tracks || []), ...localTracks],
              outputs: mergedOutputs.length > 0 ? mergedOutputs : prev.outputs,
              creatorDurationS: data.creatorDurationS ?? prev.creatorDurationS,
              creatorWidth: data.creatorWidth ?? prev.creatorWidth,
              creatorHeight: data.creatorHeight ?? prev.creatorHeight,
            };
          });

          // Show auto-edit summary toast if available
          const summary = data.autoEditResult?.summary;
          if (summary && summary.totalCuts > 0) {
            toast.success(
              `Auto-edit: ${summary.totalCuts} cut${summary.totalCuts === 1 ? '' : 's'} (${summary.totalRemovedS}s removed)`,
              { duration: 4000 }
            );
          }

          // Stop polling once everything is done
          if (creatorDone && tracksDone) {
            clearInterval(interval);
          }
        }
      } catch {
        // Ignore polling errors
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [
    compositionId,
    composition?.creatorS3Url,
    composition?.creatorTranscriptJson,
    tracksNeedTranscript,
    loading,
  ]);

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
        // Merge API response with local-only state (client-render mode stores
        // tracks and creator metadata locally — the DB doesn't have them)
        setComposition((prev) => {
          if (!prev) return data;
          const localTracks = prev.tracks.filter((t) => t.id.startsWith('local_'));
          // Preserve client-rendered blob URLs that the API doesn't know about
          const mergedOutputs = (data.outputs || []).map((o: Output) => {
            const prevOutput = prev.outputs.find((po) => po.layout === o.layout);
            if (!o.s3Url && prevOutput?.s3Url?.startsWith('blob:')) {
              return { ...o, s3Url: prevOutput.s3Url, status: prevOutput.status };
            }
            return o;
          });
          return {
            ...data,
            tracks: [...(data.tracks || []), ...localTracks],
            outputs: mergedOutputs.length > 0 ? mergedOutputs : prev.outputs,
            creatorDurationS: data.creatorDurationS ?? prev.creatorDurationS,
            creatorWidth: data.creatorWidth ?? prev.creatorWidth,
            creatorHeight: data.creatorHeight ?? prev.creatorHeight,
          };
        });
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
      // Persist to IndexedDB so file survives page refresh (fire-and-forget)
      saveCreatorFileToCache(compositionId, data.file, {
        durationS: data.durationS,
        width: data.width,
        height: data.height,
      });
      if (useClientRender) {
        // Client-render mode: no upload needed, mark complete immediately
        setCreatorUploadStatus('complete');

        // Fire background transcription via Next.js rewrite proxy to worker
        setTranscriptionStatus('transcribing');
        (async () => {
          try {
            // Step 1: Upload file directly to worker (CORS enabled, bypasses Next.js body limit)
            const workerBase =
              process.env.NEXT_PUBLIC_TRANSCRIPTION_WORKER_URL || 'http://localhost:3001';
            const formData = new FormData();
            formData.append('file', data.file);
            const workerRes = await fetch(
              `${workerBase}/transcribe?compositionId=${compositionId}`,
              { method: 'POST', body: formData }
            );
            if (!workerRes.ok) throw new Error('Worker transcription failed');
            const workerResult = await workerRes.json();

            // Step 2: Save results to DB via API
            const saveRes = await fetch(
              `/api/compositions/${compositionId}/transcribe?action=save`,
              {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  ...workerResult,
                  creatorDurationS: data.durationS,
                  creatorWidth: data.width,
                  creatorHeight: data.height,
                }),
              }
            );
            if (!saveRes.ok) throw new Error('Failed to save transcript');
            const saved = await saveRes.json();

            setTranscriptionStatus('complete');
            setComposition((prev) => {
              if (!prev) return prev;
              return {
                ...prev,
                creatorTranscriptJson: saved.creatorTranscriptJson,
                silenceRegions: saved.silenceRegions ?? prev.silenceRegions,
                autoEditResult: saved.autoEditResult ?? prev.autoEditResult,
                cuts: saved.cuts ?? prev.cuts,
              };
            });
            const summary = saved.autoEditResult?.summary;
            if (summary && summary.totalCuts > 0) {
              toast.success(
                `Auto-edit: ${summary.totalCuts} cut${summary.totalCuts === 1 ? '' : 's'} (${summary.totalRemovedS}s removed)`,
                { duration: 4000 }
              );
            }
          } catch {
            setTranscriptionStatus('error');
            toast.error('Transcription failed — captions unavailable');
          }
        })();
      } else {
        setCreatorUploadStatus('uploading');
      }
      setCreatorUploadProgress(null);
      // Update local composition state immediately so trim/timeline works
      setComposition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          creatorDurationS: data.durationS,
          creatorWidth: data.width,
          creatorHeight: data.height,
        };
      });
    },
    [useClientRender, compositionId]
  );

  const handleCreatorUploadComplete = useCallback(
    async (data: { s3Key: string; s3Url: string }) => {
      setCreatorUploadStatus('complete');
      // Use local WebCodecs metadata directly — skip server FFprobe for creator
      // (saves 2-10s round trip; worker will re-probe if needed)
      await save({
        creatorS3Key: data.s3Key,
        creatorS3Url: data.s3Url,
        creatorDurationS: creatorLocalMeta?.durationS ?? null,
        creatorWidth: creatorLocalMeta?.width ?? null,
        creatorHeight: creatorLocalMeta?.height ?? null,
      } as any);
      // Revoke blob URL and switch to CompositionVideoPanel
      if (creatorBlobUrl) URL.revokeObjectURL(creatorBlobUrl);
      setCreatorBlobUrl(null);
      setCreatorUploadStatus('idle');
    },
    [save, creatorLocalMeta, creatorBlobUrl]
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
        // Persist to IndexedDB so file survives page refresh (fire-and-forget)
        saveRefFileToCache(compositionId, tempId, data.file, {
          label: data.filename,
          durationS: data.durationS,
          width: data.width,
          height: data.height,
        });
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
    [useClientRender, compositionId]
  );

  const handleRefUploadComplete = useCallback(
    async (data: { s3Key: string; s3Url: string }) => {
      setRefUploadStatus('complete');
      setAddingTrack(true);
      // Clear blob preview immediately to prevent duplicate card flash
      if (pendingRefBlobUrl) URL.revokeObjectURL(pendingRefBlobUrl);
      setPendingRefBlobUrl(null);
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
        // Local tracks (client-render) don't exist on the server — just remove locally
        if (trackId.startsWith('local_')) {
          setRefFiles((prev) => {
            const next = new Map(prev);
            next.delete(trackId);
            return next;
          });
          clearRefFileCache(compositionId, trackId);
        } else {
          const res = await fetch(`/api/compositions/${compositionId}/tracks/${trackId}`, {
            method: 'DELETE',
          });
          if (!res.ok) throw new Error('Failed to remove track');
        }
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

  // Callback when RenderControls produces a new blob
  const handleBlobReady = useCallback(
    (layout: string, blob: Blob, url: string) => {
      setClientOutputBlobs((prev) => new Map(prev).set(layout, blob));
      setClientOutputUrls((prev) => new Map(prev).set(layout, url));
      saveBlobToCache(compositionId, layout, blob);
    },
    [compositionId]
  );

  // Callback when EditOutputModal finishes splicing
  const handleSpliceComplete = useCallback(
    (blobs: Map<string, Blob>, urls: Map<string, string>) => {
      // Replace blobs
      setClientOutputBlobs((prev) => {
        const next = new Map(prev);
        blobs.forEach((b, k) => next.set(k, b));
        return next;
      });
      // Revoke old URLs and set new ones
      setClientOutputUrls((prev) => {
        const next = new Map(prev);
        urls.forEach((u, k) => {
          const old = next.get(k);
          if (old) URL.revokeObjectURL(old);
          next.set(k, u);
        });
        return next;
      });
      // Update output s3Urls so video cards show spliced versions
      setComposition((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          outputs: prev.outputs.map((o) => {
            const newUrl = urls.get(o.layout);
            return newUrl ? { ...o, s3Url: newUrl } : o;
          }),
        };
      });
      // Persist spliced blobs to IndexedDB
      blobs.forEach((blob, layout) => saveBlobToCache(compositionId, layout, blob));
    },
    [compositionId]
  );

  // Auto-Edit: analyze transcript, save cuts, and trigger a re-render.
  // Uses server-side FFmpeg (not the client-side splicer) so cuts are applied
  // precisely without keyframe snap-back artifacts.
  const handleAutoEdit = useCallback(async () => {
    setAutoEditing(true);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/auto-edit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apply: true }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Auto-edit failed' }));
        toast.error(err.error || 'Auto-edit failed');
        return;
      }
      const result = await res.json();
      const { summary, cuts } = result;

      if (cuts.length === 0) {
        toast('No dead space or bad takes detected', { icon: '👍', duration: 3000 });
        return;
      }

      toast.success(
        `Auto-edit: ${summary.totalCuts} cut${summary.totalCuts === 1 ? '' : 's'} (${summary.totalRemovedS}s removed). Re-rendering…`,
        { duration: 4000 }
      );

      // Update local composition state with new cuts
      setComposition((prev) => (prev ? { ...prev, cuts } : prev));

      // Store cuts for EditOutputModal (if user opens it later for review)
      const modalCuts: CompositionCut[] = cuts.map(
        (c: { id: string; startS: number; endS: number }) => ({
          id: c.id,
          startS: c.startS,
          endS: c.endS,
        })
      );
      setAutoEditCuts(modalCuts);

      // Trigger a server-side re-render so FFmpeg applies cuts precisely
      const renderRes = await fetch(`/api/compositions/${compositionId}/render`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ layouts: detectOutputLayouts() }),
      });
      if (renderRes.ok) {
        // Update status to rendering so RenderControls shows progress
        setComposition((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            status: 'rendering',
            outputs: prev.outputs.map((o) => ({
              ...o,
              status: 'pending',
              s3Url: null,
              renderError: null,
            })),
          };
        });
      }
    } catch {
      toast.error('Auto-edit failed');
    } finally {
      setAutoEditing(false);
    }
  }, [compositionId, composition?.outputs, detectOutputLayouts]);

  // Clear all cuts from composition
  const handleClearCuts = useCallback(async () => {
    try {
      await save({ cuts: null } as any);
      setAutoEditCuts(undefined);
      toast.success('Cuts cleared');
    } catch {
      toast.error('Failed to clear cuts');
    }
  }, [save]);

  // Effective creator duration — local metadata as fallback (client-render may not persist to DB)
  const creatorDurationS = composition?.creatorDurationS ?? creatorLocalMeta?.durationS ?? 0;

  // Whether any transcription is still in progress (creator or tracks)
  const transcribing =
    !!(composition?.creatorS3Url && !composition.creatorTranscriptJson) || !!tracksNeedTranscript;

  // Wait for all transcripts to complete — polls the API until ready (3min timeout)
  const waitForTranscripts = useCallback(async (): Promise<Composition | null> => {
    const maxWaitMs = 3 * 60 * 1000;
    const pollIntervalMs = 3000;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(`/api/compositions/${compositionId}`);
        if (!res.ok) break;
        const data = await res.json();

        const creatorDone = !data.creatorS3Url || data.creatorTranscriptJson;
        const tracksDone = !(data.tracks || []).some(
          (t: Track) => !t.id.startsWith('local_') && t.s3Url && !t.transcriptJson
        );

        if (creatorDone && tracksDone) {
          // Merge into state, preserving client-rendered blob URLs
          setComposition((prev) => {
            if (!prev) return data;
            const localTracks = prev.tracks.filter((t) => t.id.startsWith('local_'));
            const mergedOutputs = (data.outputs || []).map((o: Output) => {
              const prevOutput = prev.outputs.find((po) => po.layout === o.layout);
              if (!o.s3Url && prevOutput?.s3Url?.startsWith('blob:')) {
                return { ...o, s3Url: prevOutput.s3Url, status: prevOutput.status };
              }
              return o;
            });
            return {
              ...data,
              tracks: [...(data.tracks || []), ...localTracks],
              outputs: mergedOutputs.length > 0 ? mergedOutputs : prev.outputs,
              creatorDurationS: data.creatorDurationS ?? prev.creatorDurationS,
              creatorWidth: data.creatorWidth ?? prev.creatorWidth,
              creatorHeight: data.creatorHeight ?? prev.creatorHeight,
            };
          });
          return data;
        }
      } catch {
        // ignore poll errors
      }
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
    }
    return null;
  }, [compositionId]);

  const handleRequestUpload = useCallback(
    async (layout: string) => {
      if (!uploadOutputRef.current) return;
      setUploadingLayout(layout);
      try {
        await uploadOutputRef.current(layout);
        // Re-fetch so the modal sees updated hasS3Key
        await fetchComposition();
      } finally {
        setUploadingLayout(null);
      }
    },
    [fetchComposition]
  );

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
          {(() => {
            // Creator video source: S3 URL or local blob
            const creatorSrc = composition.creatorS3Url || creatorBlobUrl;
            const creatorDur = creatorDurationS;
            const hasCreatorVideo = !!creatorSrc;
            // When creator exists via blob (client-render), the uploader would show
            // the blob preview instead of the dropzone. We suppress that by not passing
            // blobUrl when the creator is already shown as a CompositionVideoPanel.
            const uploaderBlobUrl = hasCreatorVideo ? null : creatorBlobUrl;

            return (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {/* Show creator video panel when a creator video exists */}
                {hasCreatorVideo && (
                  <CompositionVideoPanel
                    src={creatorSrc!}
                    label="Creator Video"
                    badge="Commentary"
                    sublabel={
                      creatorDur > 0
                        ? `${Math.floor(creatorDur / 60)}:${String(Math.floor(creatorDur % 60)).padStart(2, '0')}`
                        : undefined
                    }
                    onTimeUpdate={setCurrentTime}
                    onClick={
                      creatorDur > 0
                        ? () =>
                            setTrimTarget({
                              type: 'creator',
                              src: creatorSrc!,
                              durationS: creatorDur,
                              trimStartS: composition.creatorTrimStartS,
                              trimEndS: composition.creatorTrimEndS ?? null,
                              title: 'Trim Creator Video',
                            })
                        : undefined
                    }
                    deleting={deletingCreator}
                    onDelete={async () => {
                      if (!confirm('Delete this creator video?')) return;
                      setDeletingCreator(true);
                      try {
                        if (composition.creatorS3Url) {
                          await save({
                            creatorS3Key: null,
                            creatorS3Url: null,
                            creatorDurationS: null,
                            creatorWidth: null,
                            creatorHeight: null,
                            creatorTrimStartS: 0,
                            creatorTrimEndS: null,
                          } as any);
                        }
                        // Also clear local blob state
                        if (creatorBlobUrl) URL.revokeObjectURL(creatorBlobUrl);
                        setCreatorBlobUrl(null);
                        setCreatorFile(null);
                        setCreatorLocalMeta(null);
                        setCreatorUploadStatus('idle');
                        setTranscriptionStatus('idle');
                        clearCreatorFileCache(compositionId);
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
                        toast.success('Creator video removed');
                      } catch {
                        toast.error('Failed to remove creator video');
                      } finally {
                        setDeletingCreator(false);
                      }
                    }}
                  />
                )}

                {/* Dropzone to add or replace creator video */}
                <div className="space-y-2">
                  <VideoUploader
                    label={
                      hasCreatorVideo
                        ? 'Replace commentary video'
                        : useClientRender
                          ? 'Add your commentary video'
                          : 'Upload your commentary video'
                    }
                    blobUrl={uploaderBlobUrl}
                    uploadStatus={hasCreatorVideo ? 'idle' : creatorUploadStatus}
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
                    keyPrefix={`compositions/${compositionId}/raw`}
                  />
                  {/* Transcription status for client-render mode */}
                  {useClientRender && transcriptionStatus === 'transcribing' && (
                    <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" />
                      Transcribing...
                    </div>
                  )}
                  {useClientRender && transcriptionStatus === 'complete' && (
                    <div className="text-xs text-green-600 dark:text-green-400">
                      Transcript ready
                    </div>
                  )}
                  {useClientRender && transcriptionStatus === 'error' && (
                    <div className="text-xs text-destructive">Transcription failed</div>
                  )}
                </div>
              </div>
            );
          })()}
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
            {composition.tracks.map((track, i) => {
              const effectiveDuration = (track.trimEndS ?? track.durationS) - track.trimStartS;
              const trackTranscribing =
                !track.id.startsWith('local_') && track.s3Url && !track.transcriptJson;
              return (
                <CompositionVideoPanel
                  key={track.id}
                  src={track.s3Url}
                  label={track.label || `Reference ${i + 1}`}
                  badge={`${effectiveDuration.toFixed(1)}s`}
                  sublabel={!track.hasAudio ? 'No audio' : undefined}
                  deleting={deletingTrackId === track.id}
                  disabled={isRendering}
                  onDelete={() => handleRemoveTrack(track.id)}
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
                  extraOverlay={
                    trackTranscribing ? (
                      <div className="absolute left-1.5 top-1.5 z-10 flex items-center gap-1 rounded-full bg-black/60 px-2 py-0.5 text-[10px] text-white backdrop-blur">
                        <Loader2 className="h-2.5 w-2.5 animate-spin" />
                        Transcribing
                      </div>
                    ) : undefined
                  }
                />
              );
            })}

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
              />
            </CardContent>
          </Card>
        )}

      {/* Audio mix */}
      {/* Audio defaults to 'both' — no UI panel needed */}

      {/* Render controls */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CardTitle>Output</CardTitle>
              {((composition.creatorS3Url && !composition.creatorTranscriptJson) ||
                tracksNeedTranscript) && (
                <Badge
                  variant="outline"
                  className="gap-1 text-xs font-normal text-muted-foreground"
                >
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Transcribing...
                </Badge>
              )}
              {composition.autoEditResult?.summary &&
                composition.autoEditResult.summary.totalCuts > 0 && (
                  <Badge variant="secondary" className="text-xs font-normal">
                    {composition.autoEditResult.summary.totalCuts} cut
                    {composition.autoEditResult.summary.totalCuts === 1 ? '' : 's'} (
                    {composition.autoEditResult.summary.totalRemovedS}s removed)
                  </Badge>
                )}
            </div>
            <div className="flex gap-2">
              {(composition.creatorS3Key || creatorBlobUrl) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={handleAutoEdit}
                  disabled={isRendering || autoEditing || !composition.creatorTranscriptJson}
                  title={
                    !composition.creatorTranscriptJson
                      ? 'Waiting for transcript...'
                      : composition.silenceRegions
                        ? 'Re-analyze with current settings (instant — cached)'
                        : 'Auto-detect and remove dead space & bad takes'
                  }
                >
                  {autoEditing ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Wand2 className="h-3 w-3" />
                  )}
                  {composition.silenceRegions ? 'Re-analyze' : 'Auto-Edit'}
                </Button>
              )}
              {composition.cuts &&
                Array.isArray(composition.cuts) &&
                composition.cuts.length > 0 && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 text-xs"
                    onClick={handleClearCuts}
                    disabled={isRendering || saving}
                  >
                    <X className="h-3 w-3" />
                    Clear Cuts
                  </Button>
                )}
              {completedOutputs.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  onClick={() => {
                    setAutoEditCuts(undefined);
                    setEditOutputOpen(true);
                  }}
                  disabled={isRendering}
                >
                  <Scissors className="h-3 w-3" />
                  Edit
                </Button>
              )}
            </div>
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
            clientOutputBlobs={clientOutputBlobs}
            clientOutputUrls={clientOutputUrls}
            onBlobReady={handleBlobReady}
            captionsEnabled={captionsEnabled}
            captionFontSizePx={captionFontSizePx}
            autoEditing={autoEditing}
            transcribing={transcribing}
            onWaitForTranscripts={waitForTranscripts}
            uploadOutputRef={uploadOutputRef}
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
            // Skip API polling when outputs are client-rendered blobs (not yet on S3).
            // Instead, extract frames client-side from local files.
            skipAutoGenerate={composition.outputs?.some((o) => o.s3Url?.startsWith('blob:'))}
            creatorFile={creatorFile}
            refFiles={refFiles}
            onCompositeUrlChange={setThumbnailCompositeUrl}
          />
        </CardContent>
      </Card>

      {/* Publish */}
      {completedOutputs.length > 0 && (
        <Card>
          <CardHeader>
            <div className="space-y-1">
              <CardTitle>Publish</CardTitle>
              <CardDescription>Share your reaction to connected platforms.</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="flex items-start gap-6">
              {thumbnailCompositeUrl && (
                <div className="space-y-1.5 shrink-0">
                  <p className="text-sm font-medium">Thumbnail</p>
                  <img
                    src={thumbnailCompositeUrl}
                    alt="Composite thumbnail"
                    className="w-48 rounded-md border"
                  />
                  <p className="text-[11px] text-muted-foreground">Used as YouTube thumbnail</p>
                </div>
              )}
              <div className="flex-1 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {thumbnailCompositeUrl
                    ? 'Publish your rendered video with the current thumbnail to your connected accounts.'
                    : 'Publish your rendered video to your connected accounts.'}
                </p>
                <Button onClick={() => setPublishAllOpen(true)}>
                  <Share2 className="h-4 w-4" />
                  Publish
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Publish video modal */}
      <VideoPublishModal
        open={publishAllOpen}
        onOpenChange={setPublishAllOpen}
        compositionId={compositionId}
        compositionTitle={composition.title}
        outputs={completedOutputs.map((o) => ({
          id: o.id,
          layout: o.layout,
          s3Url: o.s3Url!,
          hasS3Key: !o.s3Url!.startsWith('blob:'),
        }))}
        trackLabels={composition.tracks.map((t) => t.label || '').filter(Boolean)}
        generationContext={{
          title: composition.title,
          trackLabels: composition.tracks.map((t) => t.label || '').filter(Boolean),
          layouts: completedOutputs.map((o) => o.layout),
          transcript: (() => {
            const parts: string[] = [];
            if (composition.creatorTranscriptJson) {
              parts.push(
                composition.creatorTranscriptJson.map((s: { text: string }) => s.text).join(' ')
              );
            }
            for (const t of composition.tracks) {
              if (t.transcriptJson) {
                parts.push(
                  (t.transcriptJson as Array<{ text: string }>).map((s) => s.text).join(' ')
                );
              }
            }
            return parts.join('\n\n') || undefined;
          })(),
        }}
        onRequestUpload={handleRequestUpload}
        uploadingLayout={uploadingLayout}
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

      {/* Edit output modal */}
      {completedOutputs.length > 0 && (
        <EditOutputModal
          open={editOutputOpen}
          onOpenChange={setEditOutputOpen}
          outputs={completedOutputs.map((o) => ({
            id: o.id,
            layout: o.layout,
            s3Url: o.s3Url!,
          }))}
          outputBlobs={clientOutputBlobs}
          onSpliceComplete={handleSpliceComplete}
          initialCuts={autoEditCuts}
        />
      )}
    </div>
  );
}
