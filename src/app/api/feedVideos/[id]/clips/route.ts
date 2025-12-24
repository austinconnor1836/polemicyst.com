import { NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { Queue } from 'bullmq';
import { redisConnection } from '@workers/queues/redisConnection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: { id: string } }
) {
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      title: true,
      s3Url: true,
      thumbnailUrl: true,
      createdAt: true,
      feed: { select: { id: true, name: true } },
      clipSourceVideoId: true,
      clipSourceVideo: {
        select: {
          id: true,
          videoTitle: true,
          s3Url: true,
          createdAt: true,
          generatedClips: {
            select: {
              id: true,
              videoTitle: true,
              sharedDescription: true,
              s3Url: true,
              s3Key: true,
              createdAt: true,
            },
            orderBy: { createdAt: 'desc' },
          },
        },
      },
    },
  });

  if (!feedVideo) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  const queue = new Queue('clip-generation', { connection: redisConnection });
  let jobState: string | null = null;
  let jobMeta: { enqueuedAt: number | null; startedAt: number | null; finishedAt: number | null } | null =
    null;

  try {
    const job = await queue.getJob(params.id);
    if (job) {
      jobState = await job.getState();
      jobMeta = {
        enqueuedAt: job.timestamp ?? null,
        startedAt: job.processedOn ?? null,
        finishedAt: job.finishedOn ?? null,
      };
    }
  } catch (err) {
    console.error('feedVideo clips route failed:', err);
  } finally {
    await queue.close();
  }

  return NextResponse.json({
    feedVideo,
    jobState,
    jobMeta,
    clips: feedVideo.clipSourceVideo?.generatedClips ?? [],
  });
}
