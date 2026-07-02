import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { parseRect, parseOrientation } from '@shared/lib/reaction-capture';

/** GET /api/capture-templates — list the current user's saved on-screen layouts. */
export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const templates = await prisma.captureTemplate.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
    });

    return NextResponse.json(templates);
  } catch (err) {
    console.error('[GET /api/capture-templates]', err);
    return NextResponse.json({ error: 'Failed to load capture templates' }, { status: 500 });
  }
}

/** POST /api/capture-templates — create a capture template (canvas + creator/reference rects). */
export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, canvasWidth, canvasHeight, referenceOrientation } = body;

    const creatorRect = parseRect(body.creatorRect);
    const referenceRect = parseRect(body.referenceRect);

    if (
      typeof canvasWidth !== 'number' ||
      typeof canvasHeight !== 'number' ||
      canvasWidth <= 0 ||
      canvasHeight <= 0
    ) {
      return NextResponse.json(
        { error: 'canvasWidth and canvasHeight must be positive numbers' },
        { status: 400 }
      );
    }
    if (!creatorRect) {
      return NextResponse.json(
        { error: 'creatorRect must be { x, y, w, h } with positive size' },
        { status: 400 }
      );
    }
    if (!referenceRect) {
      return NextResponse.json(
        { error: 'referenceRect must be { x, y, w, h } with positive size' },
        { status: 400 }
      );
    }

    const template = await prisma.captureTemplate.create({
      data: {
        userId: user.id,
        name: typeof name === 'string' && name.trim() ? name.trim() : 'Untitled layout',
        canvasWidth,
        canvasHeight,
        creatorRect,
        referenceRect,
        referenceOrientation: parseOrientation(referenceOrientation),
      },
    });

    return NextResponse.json(template, { status: 201 });
  } catch (err) {
    console.error('[POST /api/capture-templates]', err);
    return NextResponse.json({ error: 'Failed to create capture template' }, { status: 500 });
  }
}
