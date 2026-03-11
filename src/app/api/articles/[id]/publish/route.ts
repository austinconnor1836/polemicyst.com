import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { PublishService } from '@shared/lib/publishing/publish-service';
import { PublishArticleSchema } from '@shared/lib/publishing/validation';
import { SubstackError } from '@shared/lib/publishing/errors';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const parsed = PublishArticleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const service = new PublishService();

    // New flow: publish to a specific publishing account
    if (parsed.data.publishingAccountId) {
      const articlePublish = await service.publishToAccount(
        id,
        user.id,
        parsed.data.publishingAccountId,
        parsed.data.publishLive
      );
      return NextResponse.json(articlePublish);
    }

    // Legacy flow: publish via publication's Substack connection
    const article = await service.publishArticle(id, user.id, parsed.data.publishLive);
    return NextResponse.json(article);
  } catch (err) {
    if (err instanceof SubstackError) {
      const response: Record<string, unknown> = {
        error: err.message,
        code: err.code,
      };

      if (err.code === 'auth_expired') {
        response.error = 'Substack session expired — please reconnect';
      }

      return NextResponse.json(response, {
        status: err.statusCode || 500,
      });
    }

    console.error('[POST /api/articles/:id/publish] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to publish' },
      { status: 500 }
    );
  }
}
