import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getSpeakerTranscriptionQueue } from '@shared/queues';

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
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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

  return NextResponse.json({ ok: true, enqueued: true });
}

/**
 * GET /api/feedVideos/:id/speaker-transcribe
 *
 * Retrieve the existing speaker transcript for a feed video.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
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
