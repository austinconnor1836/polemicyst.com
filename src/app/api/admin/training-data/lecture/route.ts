import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!isAdmin(user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const days = Math.min(Number(params.get('days') || '30'), 365);
  const provider = params.get('provider') || undefined;
  const format = params.get('format') || 'json';

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: any = { createdAt: { gte: since } };
  if (provider) where.provider = provider;

  const examples = await prisma.lectureTrainingExample.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  if (format === 'jsonl') {
    const lines = examples.map((ex) =>
      JSON.stringify({
        input: ex.input,
        output: ex.output,
        meta: {
          id: ex.id,
          provider: ex.provider,
          model: ex.model,
          sourceFilename: ex.sourceFilename,
          frameIntervalS: ex.frameIntervalS,
          sampledFrameCount: ex.sampledFrameCount,
          extractedSlideCount: ex.extractedSlideCount,
          inputTokens: ex.inputTokens,
          outputTokens: ex.outputTokens,
          estimatedCostUsd: ex.estimatedCostUsd,
          durationMs: ex.durationMs,
          createdAt: ex.createdAt,
        },
      })
    );

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="lecture-training-data-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    });
  }

  const providerCounts: Record<string, number> = {};
  for (const ex of examples) {
    providerCounts[ex.provider] = (providerCounts[ex.provider] || 0) + 1;
  }

  return NextResponse.json({
    totalCount: examples.length,
    providerCounts,
    days,
    examples,
  });
}
