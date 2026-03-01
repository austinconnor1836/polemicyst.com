import { useCallback, useEffect, useRef, useState } from 'react';

export type ProgressStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

export interface SingleJobProgress {
  status: ProgressStatus;
  progress: number;
  stage: string | null;
  error?: string | null;
}

export interface AllJobProgress {
  transcription: SingleJobProgress;
  clipGeneration: SingleJobProgress & { error: string | null };
  speakerTranscription: SingleJobProgress;
}

const POLL_INTERVAL_ACTIVE = 2000;

function isActive(status: ProgressStatus): boolean {
  return status === 'queued' || status === 'processing';
}

export function useJobProgress(feedVideoId: string | null) {
  const [progress, setProgress] = useState<AllJobProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const fetchProgress = useCallback(async () => {
    if (!feedVideoId) return;
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/progress`, { cache: 'no-store' });
      if (!res.ok) {
        setError('Failed to fetch progress');
        return;
      }
      const data: AllJobProgress = await res.json();
      if (mountedRef.current) {
        setProgress(data);
        setError(null);
      }
    } catch {
      if (mountedRef.current) {
        setError('Failed to fetch progress');
      }
    }
  }, [feedVideoId]);

  const anyActive = progress
    ? isActive(progress.transcription.status) ||
      isActive(progress.clipGeneration.status) ||
      isActive(progress.speakerTranscription.status)
    : false;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!feedVideoId) return;
    fetchProgress();
  }, [feedVideoId, fetchProgress]);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    if (anyActive && feedVideoId) {
      intervalRef.current = setInterval(fetchProgress, POLL_INTERVAL_ACTIVE);
    }

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [anyActive, feedVideoId, fetchProgress]);

  return { progress, error, refetch: fetchProgress };
}
