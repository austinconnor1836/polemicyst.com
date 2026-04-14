import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { NextRequest, NextResponse } from 'next/server';
import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
});

const TRAINING_MATCH_TOLERANCE_S = 0.75;

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clip = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      trimStartS: true,
      trimEndS: true,
      feedVideoId: true,
      sourceVideoId: true,
    },
  });
  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const body = await req.json();
  const trimStartS = body?.trimStartS;
  const trimEndS = body?.trimEndS;

  if (trimStartS == null || trimEndS == null) {
    return NextResponse.json({ error: 'Trim start and end are required.' }, { status: 400 });
  }
  if (typeof trimStartS !== 'number' || typeof trimEndS !== 'number') {
    return NextResponse.json({ error: 'Trim values must be numbers.' }, { status: 400 });
  }
  if (trimStartS < 0 || trimEndS <= trimStartS) {
    return NextResponse.json({ error: 'Invalid trim range.' }, { status: 400 });
  }

  const previousTrimStartS = clip.trimStartS ?? trimStartS;
  const previousTrimEndS = clip.trimEndS ?? trimEndS;
  const feedbackAt = new Date();

  const updated = await prisma.$transaction(async (tx) => {
    const resolvedFeedVideoId =
      clip.feedVideoId ??
      (clip.sourceVideoId
        ? ((
            await tx.feedVideo.findFirst({
              where: { clipSourceVideoId: clip.sourceVideoId },
              select: { id: true },
            })
          )?.id ?? null)
        : null);

    const updatedClip = await tx.video.update({
      where: { id },
      data: { trimStartS, trimEndS },
      select: { id: true, trimStartS: true, trimEndS: true },
    });

    await tx.clipFeedback.create({
      data: {
        userId: user.id,
        clipId: clip.id,
        feedVideoId: resolvedFeedVideoId,
        action: 'trim_adjusted',
        oldTrimStartS: clip.trimStartS,
        oldTrimEndS: clip.trimEndS,
        newTrimStartS: trimStartS,
        newTrimEndS: trimEndS,
      },
    });

    if (resolvedFeedVideoId) {
      await tx.trainingExample.updateMany({
        where: {
          userId: user.id,
          jobId: resolvedFeedVideoId,
          tStartS: {
            gte: previousTrimStartS - TRAINING_MATCH_TOLERANCE_S,
            lte: previousTrimStartS + TRAINING_MATCH_TOLERANCE_S,
          },
          tEndS: {
            gte: previousTrimEndS - TRAINING_MATCH_TOLERANCE_S,
            lte: previousTrimEndS + TRAINING_MATCH_TOLERANCE_S,
          },
        },
        data: {
          userFeedbackLabel: 'trim_adjusted',
          userFeedbackTrimStartS: trimStartS,
          userFeedbackTrimEndS: trimEndS,
          userFeedbackCreatedAt: feedbackAt,
        },
      });
    }

    return updatedClip;
  });

  return NextResponse.json({ ...updated, feedbackLogged: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clip = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      s3Key: true,
      trimStartS: true,
      trimEndS: true,
      feedVideoId: true,
      sourceVideoId: true,
    },
  });
  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Best-effort S3 delete (DB delete still proceeds if S3 key is missing).
  if (clip.s3Key) {
    try {
      await s3
        .deleteObject({
          Bucket: S3_BUCKET,
          Key: clip.s3Key,
        })
        .promise();
    } catch (err) {
      console.error('Failed to delete clip from S3:', err);
    }
  }

  const feedbackAt = new Date();
  const targetTrimStartS = clip.trimStartS;
  const targetTrimEndS = clip.trimEndS;

  await prisma.$transaction(async (tx) => {
    const resolvedFeedVideoId =
      clip.feedVideoId ??
      (clip.sourceVideoId
        ? ((
            await tx.feedVideo.findFirst({
              where: { clipSourceVideoId: clip.sourceVideoId },
              select: { id: true },
            })
          )?.id ?? null)
        : null);

    await tx.clipFeedback.create({
      data: {
        userId: user.id,
        clipId: clip.id,
        feedVideoId: resolvedFeedVideoId,
        action: 'clip_deleted',
        oldTrimStartS: clip.trimStartS,
        oldTrimEndS: clip.trimEndS,
      },
    });

    if (
      resolvedFeedVideoId &&
      targetTrimStartS != null &&
      targetTrimEndS != null &&
      targetTrimEndS > targetTrimStartS
    ) {
      await tx.trainingExample.updateMany({
        where: {
          userId: user.id,
          jobId: resolvedFeedVideoId,
          tStartS: {
            gte: targetTrimStartS - TRAINING_MATCH_TOLERANCE_S,
            lte: targetTrimStartS + TRAINING_MATCH_TOLERANCE_S,
          },
          tEndS: {
            gte: targetTrimEndS - TRAINING_MATCH_TOLERANCE_S,
            lte: targetTrimEndS + TRAINING_MATCH_TOLERANCE_S,
          },
        },
        data: {
          userFeedbackLabel: 'clip_deleted',
          userFeedbackTrimStartS: null,
          userFeedbackTrimEndS: null,
          userFeedbackCreatedAt: feedbackAt,
        },
      });
    }

    await tx.video.delete({
      where: { id: clip.id },
    });
  });

  return NextResponse.json({ ok: true, feedbackLogged: true });
}
