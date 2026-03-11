import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const publicationId = searchParams.get('publicationId');

    const where: Record<string, unknown> = { userId: user.id };
    if (publicationId) where.publicationId = publicationId;

    const articles = await prisma.article.findMany({
      where,
      orderBy: { updatedAt: 'desc' },
      include: {
        publication: { select: { id: true, name: true } },
        _count: { select: { graphics: true } },
      },
    });

    return NextResponse.json(articles);
  } catch (err) {
    console.error('[GET /api/articles] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load articles' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { publicationId, title, sourceType, sourceId, sourceContext } = body;

    if (!publicationId) {
      return NextResponse.json({ error: 'publicationId is required' }, { status: 400 });
    }
    if (!title || typeof title !== 'string' || !title.trim()) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }

    // Verify publication ownership
    const publication = await prisma.publication.findFirst({
      where: { id: publicationId, userId: user.id },
    });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const article = await prisma.article.create({
      data: {
        publicationId,
        userId: user.id,
        title: title.trim(),
        subtitle: body.subtitle?.trim() || null,
        sourceType: sourceType || null,
        sourceId: sourceId || null,
        sourceContext: sourceContext || null,
        status: 'draft',
      },
    });

    return NextResponse.json(article, { status: 201 });
  } catch (err) {
    console.error('[POST /api/articles] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to create article' }, { status: 500 });
  }
}
