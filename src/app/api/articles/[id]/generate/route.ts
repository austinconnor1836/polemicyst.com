import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { generateArticle } from '@shared/lib/publishing/claude-client';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();
    const { topic, sourceContent, instructions } = body;

    if (!topic || typeof topic !== 'string' || !topic.trim()) {
      return NextResponse.json({ error: 'topic is required' }, { status: 400 });
    }

    // Load article with publication config
    const article = await prisma.article.findFirst({
      where: { id, userId: user.id },
      include: { publication: true },
    });
    if (!article) {
      return NextResponse.json({ error: 'Article not found' }, { status: 404 });
    }

    // Mark as generating
    await prisma.article.update({
      where: { id },
      data: { status: 'generating' },
    });

    try {
      const result = await generateArticle({
        publicationConfigMarkdown: article.publication.configMarkdown,
        topic: topic.trim(),
        sourceContent: sourceContent || undefined,
        sourceType: article.sourceType as any,
        instructions: instructions || undefined,
      });

      // Save generated content
      const updated = await prisma.article.update({
        where: { id },
        data: {
          title: result.title,
          subtitle: result.subtitle || null,
          bodyMarkdown: result.bodyMarkdown,
          bodyHtml: result.bodyHtml,
          tags: result.tags ?? undefined,
          generationModel: result._cost.modelName || null,
          status: 'review',
        },
      });

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
            metadata: { type: 'article_generation' },
          },
        })
        .catch((err: unknown) => console.error('[generate] Cost tracking failed:', err));

      return NextResponse.json(updated);
    } catch (genErr) {
      // Revert status on failure
      await prisma.article.update({
        where: { id },
        data: { status: 'draft' },
      });
      throw genErr;
    }
  } catch (err) {
    console.error('[POST /api/articles/:id/generate] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to generate article' }, { status: 500 });
  }
}
