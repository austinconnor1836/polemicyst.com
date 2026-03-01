import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { getSpeakerTranscriptionQueue } from '@shared/queues';
import { updateJobProgress } from '@shared/lib/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/speaker-transcribe
 *
 * Enqueue a speaker-identified transcription job for a feed video.
 * Body (optional): { numSpeakers?: number }
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
    select: { id: true, userId: true, speakerTranscriptJson: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  if (feedVideo.speakerTranscriptJson) {
    return NextResponse.json({
      ok: true,
      alreadyTranscribed: true,
      data: feedVideo.speakerTranscriptJson,
    });
  }

  let body: { numSpeakers?: number } = {};
  try {
    body = await req.json();
  } catch {
    // No body is fine
  }

  const queue = getSpeakerTranscriptionQueue();
  await queue.add(
    'speaker-transcribe',
    { feedVideoId: feedVideo.id, numSpeakers: body.numSpeakers },
    { jobId: `speaker-${feedVideo.id}`, removeOnComplete: true, removeOnFail: true }
  );

  await updateJobProgress({
    feedVideoId: feedVideo.id,
    jobType: 'speaker-transcription',
    status: 'queued',
    progress: 0,
    stage: 'Queued',
  });

  return NextResponse.json({ ok: true, enqueued: true });
}

/**
 * GET /api/feedVideos/:id/speaker-transcribe
 *
 * Retrieve the existing speaker transcript for a feed video.
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
    select: { id: true, userId: true, speakerTranscriptJson: true, transcript: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  if (!feedVideo.speakerTranscriptJson) {
    return NextResponse.json(
      { error: 'No speaker transcript available', hasBasicTranscript: !!feedVideo.transcript },
      { status: 404 }
    );
  }

  return NextResponse.json(feedVideo.speakerTranscriptJson);
}
