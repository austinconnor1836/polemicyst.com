import { prisma } from './prisma';

export type ProgressJobType = 'transcription' | 'clip-generation' | 'speaker-transcription';
export type ProgressStatus = 'idle' | 'queued' | 'processing' | 'completed' | 'failed';

interface UpdateProgressParams {
  feedVideoId: string;
  jobType: ProgressJobType;
  status: ProgressStatus;
  progress: number;
  stage?: string | null;
  error?: string | null;
}

const fieldMap: Record<
  ProgressJobType,
  { status: string; progress: string; stage: string; error?: string }
> = {
  transcription: {
    status: 'transcriptionStatus',
    progress: 'transcriptionProgress',
    stage: 'transcriptionStage',
  },
  'clip-generation': {
    status: 'clipGenerationStatus',
    progress: 'clipGenerationProgress',
    stage: 'clipGenerationStage',
    error: 'clipGenerationError',
  },
  'speaker-transcription': {
    status: 'speakerTranscriptionStatus',
    progress: 'speakerTranscriptionProgress',
    stage: 'speakerTranscriptionStage',
  },
};

export async function updateJobProgress(params: UpdateProgressParams): Promise<void> {
  const { feedVideoId, jobType, status, progress, stage, error } = params;
  const fields = fieldMap[jobType];
  if (!fields) return;

  const data: Record<string, unknown> = {
    [fields.status]: status,
    [fields.progress]: Math.min(100, Math.max(0, Math.round(progress))),
    [fields.stage]: stage ?? null,
  };

  if (fields.error !== undefined) {
    data[fields.error] = error ?? null;
  }

  try {
    await prisma.feedVideo.update({
      where: { id: feedVideoId },
      data,
    });
  } catch (err) {
    console.error('Failed to update job progress (non-fatal):', err);
  }
}

export function resetJobProgress(
  feedVideoId: string,
  jobType: ProgressJobType
): Promise<void> {
  return updateJobProgress({
    feedVideoId,
    jobType,
    status: 'idle',
    progress: 0,
    stage: null,
  });
}

export interface JobProgressInfo {
  transcription: {
    status: ProgressStatus;
    progress: number;
    stage: string | null;
  };
  clipGeneration: {
    status: ProgressStatus;
    progress: number;
    stage: string | null;
    error: string | null;
  };
  speakerTranscription: {
    status: ProgressStatus;
    progress: number;
    stage: string | null;
  };
}

export async function getJobProgress(feedVideoId: string): Promise<JobProgressInfo | null> {
  const fv = await prisma.feedVideo.findUnique({
    where: { id: feedVideoId },
    select: {
      transcriptionStatus: true,
      transcriptionProgress: true,
      transcriptionStage: true,
      clipGenerationStatus: true,
      clipGenerationProgress: true,
      clipGenerationStage: true,
      clipGenerationError: true,
      speakerTranscriptionStatus: true,
      speakerTranscriptionProgress: true,
      speakerTranscriptionStage: true,
    },
  });

  if (!fv) return null;

  return {
    transcription: {
      status: fv.transcriptionStatus as ProgressStatus,
      progress: fv.transcriptionProgress,
      stage: fv.transcriptionStage,
    },
    clipGeneration: {
      status: fv.clipGenerationStatus as ProgressStatus,
      progress: fv.clipGenerationProgress,
      stage: fv.clipGenerationStage,
      error: fv.clipGenerationError,
    },
    speakerTranscription: {
      status: fv.speakerTranscriptionStatus as ProgressStatus,
      progress: fv.speakerTranscriptionProgress,
      stage: fv.speakerTranscriptionStage,
    },
  };
}
