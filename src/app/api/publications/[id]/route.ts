import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const publication = await prisma.publication.findFirst({
      where: { id, userId: user.id },
    });

    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    return NextResponse.json(publication);
  } catch (err) {
    console.error('[GET /api/publications/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load publication' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    // Verify ownership
    const existing = await prisma.publication.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.name !== undefined) data.name = body.name.trim();
    if (body.tagline !== undefined) data.tagline = body.tagline?.trim() || null;
    if (body.configMarkdown !== undefined) data.configMarkdown = body.configMarkdown;
    if (body.configJson !== undefined) data.configJson = body.configJson;
    if (body.substackUrl !== undefined) data.substackUrl = body.substackUrl;
    if (body.isDefault !== undefined) data.isDefault = body.isDefault;

    const publication = await prisma.publication.update({
      where: { id },
      data,
    });

    return NextResponse.json(publication);
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A publication with that name already exists' },
        { status: 409 }
      );
    }
    console.error('[PUT /api/publications/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to update publication' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.publication.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    await prisma.publication.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/publications/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to delete publication' }, { status: 500 });
  }
}
