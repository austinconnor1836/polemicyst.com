import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { parseRect, parseOrientation } from '@shared/lib/reaction-capture';

/** PUT /api/capture-templates/[id] — update a saved layout. */
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await prisma.captureTemplate.findFirst({ where: { id, userId: user.id } });
    if (!existing) {
      return NextResponse.json({ error: 'Capture template not found' }, { status: 404 });
    }

    const body = await req.json();
    const data: Record<string, unknown> = {};

    if (typeof body.name === 'string' && body.name.trim()) data.name = body.name.trim();
    if (typeof body.canvasWidth === 'number' && body.canvasWidth > 0)
      data.canvasWidth = body.canvasWidth;
    if (typeof body.canvasHeight === 'number' && body.canvasHeight > 0)
      data.canvasHeight = body.canvasHeight;
    if (body.referenceOrientation !== undefined)
      data.referenceOrientation = parseOrientation(body.referenceOrientation);
    if (body.creatorRect !== undefined) {
      const rect = parseRect(body.creatorRect);
      if (!rect)
        return NextResponse.json({ error: 'creatorRect must be { x, y, w, h }' }, { status: 400 });
      data.creatorRect = rect;
    }
    if (body.referenceRect !== undefined) {
      const rect = parseRect(body.referenceRect);
      if (!rect)
        return NextResponse.json(
          { error: 'referenceRect must be { x, y, w, h }' },
          { status: 400 }
        );
      data.referenceRect = rect;
    }

    const template = await prisma.captureTemplate.update({ where: { id }, data });
    return NextResponse.json(template);
  } catch (err) {
    console.error('[PUT /api/capture-templates/[id]]', err);
    return NextResponse.json({ error: 'Failed to update capture template' }, { status: 500 });
  }
}

/** DELETE /api/capture-templates/[id] */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const existing = await prisma.captureTemplate.findFirst({ where: { id, userId: user.id } });
    if (!existing) {
      return NextResponse.json({ error: 'Capture template not found' }, { status: 404 });
    }

    await prisma.captureTemplate.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/capture-templates/[id]]', err);
    return NextResponse.json({ error: 'Failed to delete capture template' }, { status: 500 });
  }
}
