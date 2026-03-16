import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getStarterConfigMarkdown } from '@shared/lib/publishing/config-template';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const publications = await prisma.publication.findMany({
      where: { userId: user.id },
      orderBy: { updatedAt: 'desc' },
      include: { _count: { select: { articles: true } } },
    });

    return NextResponse.json(publications);
  } catch (err) {
    console.error('[GET /api/publications] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load publications' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const { name, tagline } = body;

    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const configMarkdown = body.configMarkdown || getStarterConfigMarkdown(name.trim());

    const publication = await prisma.publication.create({
      data: {
        userId: user.id,
        name: name.trim(),
        tagline: tagline?.trim() || null,
        configMarkdown,
      },
    });

    return NextResponse.json(publication, { status: 201 });
  } catch (err: any) {
    if (err?.code === 'P2002') {
      return NextResponse.json(
        { error: 'A publication with that name already exists' },
        { status: 409 }
      );
    }
    console.error('[POST /api/publications] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to create publication' }, { status: 500 });
  }
}
