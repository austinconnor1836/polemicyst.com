import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { getClipGenerationQueue } from '@shared/queues';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;
  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      videoId: true,
      title: true,
      s3Url: true,
      status: true,
      thumbnailUrl: true,
      createdAt: true,
      feed: { select: { id: true, name: true, sourceType: true } },
      clipSourceVideoId: true,
      transcript: true,
      transcriptJson: true,
      transcriptSource: true,
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
              trimStartS: true,
              trimEndS: true,
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

  const queue = getClipGenerationQueue();
  let jobState: string | null = null;
  let jobMeta: {
    enqueuedAt: number | null;
    startedAt: number | null;
    finishedAt: number | null;
  } | null = null;

  try {
    const job = await queue.getJob(id);
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
  }

  return NextResponse.json({
    feedVideo,
    jobState,
    jobMeta,
    clips: feedVideo.clipSourceVideo?.generatedClips ?? [],
  });
}
