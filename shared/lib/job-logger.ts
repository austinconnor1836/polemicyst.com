import { prisma } from './prisma';

export type JobType =
  | 'transcription'
  | 'speaker-transcription'
  | 'clip-generation'
  | 'download'
  | 'stitch-render';

export type JobStatus = 'queued' | 'started' | 'completed' | 'failed';

interface LogJobParams {
  /**
   * The schema column is `feedVideoId` for legacy reasons but the field is used
   * as a generic per-job correlation id. For `stitch-render` we pass the
   * `compositionId` here so all rows for that render land together in the
   * admin logs view.
   */
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
        metadata: (params.metadata as any) ?? undefined,
      },
    });
  } catch (err) {
    console.error('Failed to write job log (non-fatal):', err);
  }
}
