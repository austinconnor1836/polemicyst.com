import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { getTranscriptionQueue } from '@shared/queues';
import { logJob } from '@shared/lib/job-logger';
import { updateJobProgress } from '@shared/lib/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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

  await updateJobProgress({
    feedVideoId: feedVideo.id,
    jobType: 'transcription',
    status: 'queued',
    progress: 0,
    stage: 'Queued',
  });

  await logJob({
    feedVideoId: feedVideo.id,
    jobType: 'transcription',
    status: 'queued',
    message: 'Transcription job queued via API',
  });

  return NextResponse.json({ ok: true, enqueued: true });
}
