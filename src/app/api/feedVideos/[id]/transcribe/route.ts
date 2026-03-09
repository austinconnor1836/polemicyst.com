import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getTranscriptionQueue } from '@shared/queues';
import { logJob } from '@shared/lib/job-logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true, transcript: true, transcriptJson: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  if (feedVideo.transcript && feedVideo.transcriptJson) {
    return NextResponse.json({ ok: true, alreadyTranscribed: true });
  }

  const transcriptionQueue = getTranscriptionQueue();
  await transcriptionQueue.add(
    'transcribe',
    { feedVideoId: feedVideo.id },
    { jobId: feedVideo.id, removeOnComplete: true, removeOnFail: true }
  );

  await logJob({
    feedVideoId: feedVideo.id,
    jobType: 'transcription',
    status: 'queued',
    message: 'Transcription job queued via API',
  });

  return NextResponse.json({ ok: true, enqueued: true });
}
