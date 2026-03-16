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

    // Verify article belongs to user
    const article = await prisma.article.findFirst({
      where: { id, userId: user.id },
    });
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    const publishes = await prisma.articlePublish.findMany({
      where: { articleId: id },
      include: {
        publishingAccount: {
          select: {
            id: true,
            platform: true,
            displayName: true,
            platformUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Flatten for frontend consumption
    const result = publishes.map((p) => ({
      id: p.id,
      publishingAccountId: p.publishingAccountId,
      platform: p.publishingAccount.platform,
      displayName: p.publishingAccount.displayName,
      accountPlatformUrl: p.publishingAccount.platformUrl,
      status: p.status,
      platformUrl: p.platformUrl,
      platformDraftId: p.platformDraftId,
      publishedAt: p.publishedAt,
      publishError: p.publishError,
      createdAt: p.createdAt,
    }));

    return NextResponse.json(result);
  } catch (err) {
    console.error('[GET /api/articles/:id/publishes] Error:', err);
    return NextResponse.json({ error: 'Failed to load publish history' }, { status: 500 });
  }
}
