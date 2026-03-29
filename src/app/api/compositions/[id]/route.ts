import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { queueGenericTranscriptionJob } from '@shared/queues';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
        thumbnails: { orderBy: { frameTimestampS: 'asc' } },
      },
    });

    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(composition);
  } catch (err) {
    console.error('[GET /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to load composition' }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const body = await req.json();
    const allowed = [
      'title',
      'mode',
      'audioMode',
      'creatorVolume',
      'referenceVolume',
      'creatorS3Key',
      'creatorS3Url',
      'creatorDurationS',
      'creatorWidth',
      'creatorHeight',
      'creatorTrimStartS',
      'creatorTrimEndS',
      'cuts',
    ] as const;
    const data: Record<string, any> = {};
    for (const key of allowed) {
      if (body[key] !== undefined) {
        data[key] = body[key];
      }
    }

    // Auto-clear cuts when creator video is removed (stale cuts for old content)
    if (data.creatorS3Key === null && data.cuts === undefined) {
      data.cuts = null;
    }

    // Validate cuts if provided
    if (data.cuts !== undefined && data.cuts !== null) {
      if (!Array.isArray(data.cuts)) {
        return NextResponse.json({ error: 'cuts must be an array' }, { status: 400 });
      }
      for (const cut of data.cuts) {
        if (!cut.id || typeof cut.startS !== 'number' || typeof cut.endS !== 'number') {
          return NextResponse.json(
            { error: 'Each cut must have id, startS, endS' },
            { status: 400 }
          );
        }
        if (cut.startS < 0 || cut.endS < 0) {
          return NextResponse.json({ error: 'Cut times must be >= 0' }, { status: 400 });
        }
        if (cut.endS <= cut.startS) {
          return NextResponse.json({ error: 'Cut endS must be > startS' }, { status: 400 });
        }
      }
      // Check for overlapping cuts (sorted by startS)
      const sorted = [...data.cuts].sort((a: any, b: any) => a.startS - b.startS);
      for (let i = 0; i < sorted.length - 1; i++) {
        if (sorted[i].endS > sorted[i + 1].startS) {
          return NextResponse.json({ error: 'Cuts must not overlap' }, { status: 400 });
        }
      }
    }

    const composition = await prisma.composition.update({
      where: { id },
      data,
      include: {
        tracks: { orderBy: { sortOrder: 'asc' } },
        outputs: true,
        thumbnails: { orderBy: { frameTimestampS: 'asc' } },
      },
    });

    // Queue transcription when creator video is set (non-fatal)
    if (data.creatorS3Url) {
      try {
        await queueGenericTranscriptionJob({
          s3Url: data.creatorS3Url,
          targetModel: 'Composition',
          targetId: id,
        });
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json(composition);
  } catch (err) {
    console.error('[PATCH /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to update composition' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.composition.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    await prisma.composition.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/compositions/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete composition' }, { status: 500 });
  }
}
