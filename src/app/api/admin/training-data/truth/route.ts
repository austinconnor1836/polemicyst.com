import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import { isAdmin } from '@shared/lib/admin';

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!isAdmin(session?.user?.email)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const params = req.nextUrl.searchParams;
  const days = Math.min(Number(params.get('days') || '30'), 365);
  const provider = params.get('provider') || undefined;
  const type = params.get('type') || undefined; // analysis | chat
  const format = params.get('format') || 'json';

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: any = { createdAt: { gte: since } };
  if (provider) where.provider = provider;
  if (type) where.type = type;

  const examples = await prisma.truthTrainingExample.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  if (format === 'jsonl') {
    const lines = examples.map((ex) => {
      const row = {
        input: {
          transcriptText: ex.transcriptText,
          analysisContext: ex.analysisContext,
          conversationHistory: ex.conversationHistory,
          type: ex.type,
        },
        output: ex.result,
        meta: {
          id: ex.id,
          provider: ex.provider,
          model: ex.model,
          feedVideoId: ex.feedVideoId,
          overallCredibility: ex.overallCredibility,
          assertionCount: ex.assertionCount,
          fallacyCount: ex.fallacyCount,
          biasCount: ex.biasCount,
          estimatedCostUsd: ex.estimatedCostUsd,
          createdAt: ex.createdAt,
        },
      };
      return JSON.stringify(row);
    });

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="truth-training-data-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    });
  }

  // Summary stats
  const totalCount = examples.length;
  const providerCounts: Record<string, number> = {};
  const typeCounts: Record<string, number> = {};

  for (const ex of examples) {
    providerCounts[ex.provider] = (providerCounts[ex.provider] || 0) + 1;
    typeCounts[ex.type] = (typeCounts[ex.type] || 0) + 1;
  }

  return NextResponse.json({
    totalCount,
    providerCounts,
    typeCounts,
    days,
    examples,
  });
}
