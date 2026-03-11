import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { generateGraphics } from '@shared/lib/publishing/claude-client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { types } = body;

    // Load article with publication config
    const article = await prisma.article.findFirst({
      where: { id, userId: user.id },
      include: { publication: true },
    });
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    if (!article.bodyMarkdown) {
      return NextResponse.json(
        { error: 'Article has no body content. Generate the article first.' },
        { status: 400 }
      );
    }

    const result = await generateGraphics({
      publicationConfigMarkdown: article.publication.configMarkdown,
      articleTitle: article.title,
      articleBody: article.bodyMarkdown,
      types: types || undefined,
    });

    // Delete existing graphics for this article before saving new ones
    await prisma.articleGraphic.deleteMany({ where: { articleId: id } });

    // Save generated graphics
    const graphics = await Promise.all(
      result.graphics.map((g, i) =>
        prisma.articleGraphic.create({
          data: {
            articleId: id,
            type: g.type,
            label: g.label,
            htmlContent: g.htmlContent,
            position: i,
          },
        })
      )
    );

    // Track cost
    await prisma.costEvent
      .create({
        data: {
          userId: user.id,
          jobId: id,
          stage: 'llm_scoring',
          provider: 'anthropic',
          model: result._cost.modelName || null,
          inputTokens: result._cost.inputTokens || null,
          outputTokens: result._cost.outputTokens || null,
          durationMs: result._cost.durationMs || null,
          estimatedCostUsd: result._cost.estimatedCostUsd,
          metadata: { type: 'graphics_generation' },
        },
      })
      .catch((err: unknown) => console.error('[generate-graphics] Cost tracking failed:', err));

    return NextResponse.json({ graphics });
  } catch (err) {
    console.error('[POST /api/articles/:id/generate-graphics] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to generate graphics' }, { status: 500 });
  }
}
