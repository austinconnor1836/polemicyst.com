import { prisma } from './prisma';

export type JobType =
  | 'transcription'
  | 'speaker-transcription'
  | 'clip-generation'
  | 'download';

export type JobStatus = 'queued' | 'started' | 'completed' | 'failed';

interface LogJobParams {
  feedVideoId: string;
  jobType: JobType;
  status: JobStatus;
  message?: string;
  error?: string;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export async function logJob(params: LogJobParams): Promise<void> {
  try {
    await prisma.jobLog.create({
      data: {
        feedVideoId: params.feedVideoId,
        jobType: params.jobType,
        status: params.status,
        message: params.message ?? null,
        error: params.error ?? null,
        durationMs: params.durationMs ?? null,
        metadata: params.metadata ?? undefined,
      },
    });
  } catch (err) {
    console.error('Failed to write job log (non-fatal):', err);
  }
}
