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

    const article = await prisma.article.findFirst({
      where: { id, userId: user.id },
      include: {
        publication: {
          select: {
            id: true,
            name: true,
            configMarkdown: true,
            substackConnected: true,
            substackUrl: true,
          },
        },
        graphics: { orderBy: { position: 'asc' } },
      },
    });

    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    return NextResponse.json(article);
  } catch (err) {
    console.error('[GET /api/articles/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load article' }, { status: 500 });
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

    const existing = await prisma.article.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const data: Record<string, unknown> = {};
    if (body.title !== undefined) data.title = body.title;
    if (body.subtitle !== undefined) data.subtitle = body.subtitle;
    if (body.bodyMarkdown !== undefined) data.bodyMarkdown = body.bodyMarkdown;
    if (body.bodyHtml !== undefined) data.bodyHtml = body.bodyHtml;
    if (body.status !== undefined) data.status = body.status;
    if (body.tags !== undefined) data.tags = body.tags;

    const article = await prisma.article.update({
      where: { id },
      data,
    });

    return NextResponse.json(article);
  } catch (err) {
    console.error('[PUT /api/articles/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to update article' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const existing = await prisma.article.findFirst({
      where: { id, userId: user.id },
    });
    if (!existing) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    await prisma.article.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[DELETE /api/articles/:id] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to delete article' }, { status: 500 });
  }
}
