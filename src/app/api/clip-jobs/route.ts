import { NextResponse } from 'next/server';
import { Queue } from 'bullmq';
import { redisConnection } from '@workers/queues/redisConnection';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
import { prisma } from '@shared/lib/prisma';

type ClipJobSummary = {
  jobId: string | number;
  feedVideoId: string;
  state: string;
  enqueuedAt: number | null;
  startedAt: number | null;
  feedName: string | null;
  title: string;
  clipSourceVideoId: string | null;
};

export async function GET() {
  const queue = new Queue('clip-generation', { connection: redisConnection });
  const now = Date.now();
  const staleMs = 2 * 60 * 60 * 1000;

  try {
    const jobs = await queue.getJobs(['waiting', 'active', 'delayed'], 0, 50);
    if (!jobs.length) {
      return NextResponse.json([]);
    }

    const feedVideoIds = Array.from(
      new Set(
        jobs
          .map((job) => job.data?.feedVideoId)
          .filter((id): id is string => typeof id === 'string' && id.length > 0)
      )
    );

    if (!feedVideoIds.length) {
      return NextResponse.json([]);
    }

    const feedVideos = await prisma.feedVideo.findMany({
      where: { id: { in: feedVideoIds } },
      select: {
        id: true,
        title: true,
        thumbnailUrl: true,
        createdAt: true,
        clipSourceVideoId: true,
        feed: { select: { id: true, name: true } },
      },
    });

    const feedMap = new Map(feedVideos.map((video) => [video.id, video]));

    const summaries: ClipJobSummary[] = [];

    for (const job of jobs) {
      const feedVideoId = job.data?.feedVideoId as string | undefined;
      if (!feedVideoId) {
        try {
          await job.remove();
        } catch {}
        continue;
      }
      const meta = feedMap.get(feedVideoId);
      if (!meta) {
        try {
          await job.remove();
        } catch {}
        continue;
      }

      let state = 'unknown';
      try {
        state = await job.getState();
      } catch {
        state = 'unknown';
      }

      const ageMs = now - (job.timestamp ?? now);
      if ((state === 'waiting' || state === 'delayed') && ageMs > staleMs) {
        try {
          await job.remove();
        } catch {}
        continue;
      }

      if (meta.clipSourceVideoId && state !== 'active') {
        try {
          await job.remove();
        } catch {}
        continue;
      }

      summaries.push({
        jobId: job.id ?? feedVideoId,
        feedVideoId,
        state,
        enqueuedAt: job.timestamp ?? null,
        startedAt: job.processedOn ?? null,
        feedName: meta.feed?.name ?? null,
        title: meta.title,
        clipSourceVideoId: meta.clipSourceVideoId ?? null,
      });
    }

    return NextResponse.json(summaries);
  } catch (err) {
    console.error('clip-jobs route failed:', err);
    return NextResponse.json({ error: 'Failed to load jobs' }, { status: 500 });
  } finally {
    await queue.close();
  }
}
