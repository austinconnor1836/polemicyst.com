import { prisma } from '@shared/lib/prisma';
import { getClipGenerationQueue } from '@shared/queues';
import { logJob } from '@shared/lib/job-logger';

interface TriggerClipInput {
  feedVideoId: string;
  userId: string;
  aspectRatio?: string;
  scoringMode?: string;
  includeAudio?: boolean;
  saferClips?: boolean;
  targetPlatform?: string;
  contentStyle?: string;
  minCandidates?: number;
  maxCandidates?: number;
  minScore?: number;
  percentile?: number;
  maxGeminiCandidates?: number;
  llmProvider?: string;
  clipLength?: string;
}

type TriggerClipResult =
  | { status: 'enqueued'; jobId: string | undefined }
  | { status: 'already_running'; jobId: string | undefined }
  | { status: 'locked'; jobId: string | undefined };

export async function triggerClipGeneration(input: TriggerClipInput): Promise<TriggerClipResult> {
  const queue = getClipGenerationQueue();

  const existingJob = await queue.getJob(input.feedVideoId);
  if (existingJob) {
    const state = await existingJob.getState();
    if (state === 'active' || state === 'waiting' || state === 'delayed') {
      return { status: 'already_running', jobId: existingJob.id };
    }

    try {
      await existingJob.remove();
    } catch (err: any) {
      console.warn(`Could not remove existing job ${input.feedVideoId}: ${err.message}`);
      return { status: 'locked', jobId: existingJob.id };
    }
  }

  await prisma.feedVideo.update({
    where: { id: input.feedVideoId },
    data: { clipGenerationStatus: 'queued', clipGenerationError: null },
  });

  const resolvedProvider =
    typeof input.llmProvider === 'string' && input.llmProvider.toLowerCase() === 'ollama'
      ? 'ollama'
      : 'gemini';

  const job = await queue.add(
    'clip-generation',
    {
      feedVideoId: input.feedVideoId,
      userId: input.userId,
      aspectRatio: input.aspectRatio,
      scoringMode: input.scoringMode,
      includeAudio: input.includeAudio,
      saferClips: input.saferClips,
      targetPlatform: input.targetPlatform,
      contentStyle: input.contentStyle,
      minCandidates: input.minCandidates,
      maxCandidates: input.maxCandidates,
      minScore: input.minScore,
      percentile: input.percentile,
      maxGeminiCandidates: input.maxGeminiCandidates,
      llmProvider: resolvedProvider,
      clipLength: input.clipLength,
    },
    { jobId: input.feedVideoId, removeOnComplete: true, removeOnFail: true }
  );

  await logJob({
    feedVideoId: input.feedVideoId,
    jobType: 'clip-generation',
    status: 'queued',
    message: 'Clip-generation job queued via API',
  });

  return { status: 'enqueued', jobId: job.id };
}
