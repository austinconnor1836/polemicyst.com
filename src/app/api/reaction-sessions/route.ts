import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getReactionComposeQueue } from '@shared/queues';
import { S3_BUCKET, S3_REGION } from '@shared/lib/storage/storage-provider';
import { parseRect, parseOrientation, parseBoundaries } from '@shared/lib/reaction-capture';

const MAX_REACTIONS = 40;

const directS3Url = (s3Key: string) =>
  `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;

/** GET /api/reaction-sessions — list the user's capture-split sessions with child compositions. */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const sessions = await prisma.reactionSession.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: {
        compositions: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, title: true, status: true },
        },
      },
    });

    return NextResponse.json(sessions);
  } catch (err) {
    console.error('[GET /api/reaction-sessions]', err);
    return NextResponse.json({ error: 'Failed to load reaction sessions' }, { status: 500 });
  }
}

/**
 * POST /api/reaction-sessions
 *
 * Fan out one long capture into one composition per confirmed reaction window. Each
 * composition crops the creator + reference feeds out of the single capture (via
 * `creatorSourceCrop` + reference-track `sourceCrop`) and trims to that window. The
 * capture's audio is a single mixed track, so we drive audio from the creator source
 * (`audioMode: 'creator'`) and mute the reference track to avoid double audio.
 *
 * Body: {
 *   title?, captureS3Key, captureS3Url?, captureDurationS?, templateId?,
 *   creatorRect, referenceRect, referenceOrientation?, boundaries[], render?
 * }
 */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();

    const captureS3Key = body.captureS3Key;
    if (typeof captureS3Key !== 'string' || !captureS3Key) {
      return NextResponse.json({ error: 'captureS3Key is required' }, { status: 400 });
    }
    const captureS3Url = directS3Url(captureS3Key);

    const creatorRect = parseRect(body.creatorRect);
    const referenceRect = parseRect(body.referenceRect);
    if (!creatorRect) {
      return NextResponse.json({ error: 'creatorRect must be { x, y, w, h }' }, { status: 400 });
    }
    if (!referenceRect) {
      return NextResponse.json({ error: 'referenceRect must be { x, y, w, h }' }, { status: 400 });
    }

    const boundaries = parseBoundaries(body.boundaries);
    if (!boundaries) {
      return NextResponse.json(
        { error: 'boundaries must be a non-empty array of { startS, endS }' },
        { status: 400 }
      );
    }
    if (boundaries.length > MAX_REACTIONS) {
      return NextResponse.json(
        { error: `Too many reactions (${boundaries.length}); max ${MAX_REACTIONS}` },
        { status: 400 }
      );
    }

    const captureDurationS =
      typeof body.captureDurationS === 'number' ? body.captureDurationS : null;
    const referenceOrientation = parseOrientation(body.referenceOrientation);
    const shouldRender = body.render !== false;
    const title =
      typeof body.title === 'string' && body.title.trim() ? body.title.trim() : 'Reaction session';

    const session = await prisma.reactionSession.create({
      data: {
        userId: user.id,
        title,
        captureS3Key,
        captureS3Url,
        captureDurationS,
        templateId: typeof body.templateId === 'string' ? body.templateId : null,
        creatorRect,
        referenceRect,
        referenceOrientation,
        boundaries,
        status: shouldRender ? 'rendering' : 'draft',
      },
    });

    const queue = shouldRender ? getReactionComposeQueue() : null;
    const created: Array<{ id: string; title: string }> = [];

    for (let i = 0; i < boundaries.length; i++) {
      const w = boundaries[i];
      const compTitle = `${title} — Reaction ${i + 1}`;

      const composition = await prisma.composition.create({
        data: {
          userId: user.id,
          title: compTitle,
          mode: 'pre-synced',
          audioMode: 'creator', // capture carries a single mixed audio track
          reactionSessionId: session.id,
          creatorS3Key: captureS3Key,
          creatorS3Url: captureS3Url,
          creatorDurationS: captureDurationS,
          creatorTrimStartS: w.startS,
          creatorTrimEndS: w.endS,
          creatorSourceCrop: creatorRect,
          status: shouldRender ? 'rendering' : 'draft',
        },
      });

      await prisma.compositionTrack.create({
        data: {
          compositionId: composition.id,
          trackType: 'reference',
          label: `Reference ${i + 1}`,
          s3Key: captureS3Key,
          s3Url: captureS3Url,
          durationS: captureDurationS ?? w.endS,
          startAtS: 0,
          trimStartS: w.startS,
          trimEndS: w.endS,
          sortOrder: 0,
          hasAudio: false, // muted — audio comes from the creator source
          sourceCrop: referenceRect,
        },
      });

      if (queue) {
        const layouts = ['mobile', 'landscape'];
        await prisma.compositionOutput.createMany({
          data: layouts.map((layout) => ({
            compositionId: composition.id,
            layout,
            status: 'pending',
          })),
        });
        await queue.add(
          'reaction-compose',
          { compositionId: composition.id, userId: user.id, layouts },
          { jobId: composition.id, removeOnComplete: true, removeOnFail: true }
        );
      }

      created.push({ id: composition.id, title: compTitle });
    }

    return NextResponse.json(
      { sessionId: session.id, rendering: shouldRender, compositions: created },
      { status: 201 }
    );
  } catch (err) {
    console.error('[POST /api/reaction-sessions]', err);
    return NextResponse.json({ error: 'Failed to create reaction session' }, { status: 500 });
  }
}
