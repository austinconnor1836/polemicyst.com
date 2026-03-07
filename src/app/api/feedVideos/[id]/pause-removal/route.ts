import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { queuePauseRemovalJob } from '@shared/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/pause-removal
 * Body: { estimatedPauseCount: number }
 * Enqueues a pause-removal job for the given feed video.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  let body: { estimatedPauseCount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const estimatedPauseCount = body.estimatedPauseCount;
  if (
    typeof estimatedPauseCount !== 'number' ||
    !Number.isFinite(estimatedPauseCount) ||
    estimatedPauseCount < 1 ||
    estimatedPauseCount > 500
  ) {
    return NextResponse.json(
      { error: 'estimatedPauseCount must be an integer between 1 and 500' },
      { status: 400 }
    );
  }

  const count = Math.round(estimatedPauseCount);

  // Check for an already-running job
  const existingJob = await prisma.pauseRemovalJob.findFirst({
    where: {
      feedVideoId: id,
      status: { in: ['queued', 'processing'] },
    },
  });
  if (existingJob) {
    return NextResponse.json(
      { error: 'A pause removal job is already in progress for this video', jobId: existingJob.id },
      { status: 409 }
    );
  }

  const job = await prisma.pauseRemovalJob.create({
    data: {
      feedVideoId: id,
      userId: user.id,
      estimatedPauseCount: count,
      status: 'queued',
    },
  });

  await queuePauseRemovalJob({
    pauseRemovalJobId: job.id,
    feedVideoId: id,
    userId: user.id,
    estimatedPauseCount: count,
  });

  return NextResponse.json({ ok: true, jobId: job.id });
}

/**
 * GET /api/feedVideos/:id/pause-removal
 * Returns all pause removal jobs for this video (newest first).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  const jobs = await prisma.pauseRemovalJob.findMany({
    where: { feedVideoId: id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  return NextResponse.json({ jobs });
}
