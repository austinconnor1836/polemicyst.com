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
  const minConfidence = params.get('minConfidence')
    ? Number(params.get('minConfidence'))
    : undefined;
  const onlySelected = params.get('onlySelected') === 'true';
  const format = params.get('format') || 'json';

  const since = new Date();
  since.setDate(since.getDate() - days);

  const where: any = { createdAt: { gte: since } };
  if (provider) where.provider = provider;
  if (minConfidence != null) where.confidence = { gte: minConfidence };
  if (onlySelected) where.wasSelected = true;

  const examples = await prisma.trainingExample.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: 10000,
  });

  if (format === 'jsonl') {
    const lines = examples.map((ex) => {
      const row = {
        // Input
        input: {
          transcriptText: ex.transcriptText,
          tStartS: ex.tStartS,
          tEndS: ex.tEndS,
          targetPlatform: ex.targetPlatform,
          contentStyle: ex.contentStyle,
          saferClips: ex.saferClips,
          includeAudio: ex.includeAudio,
          frameCount: ex.frameCount,
          audioSeconds: ex.audioSeconds,
          heuristicScore: ex.heuristicScore,
          heuristicFeatures: ex.heuristicFeatures,
        },
        // Output (training target)
        output: {
          score: ex.llmScore,
          hookScore: ex.hookScore,
          contextScore: ex.contextScore,
          captionabilityScore: ex.captionabilityScore,
          comedicScore: ex.comedicScore,
          provocativeScore: ex.provocativeScore,
          visualEnergyScore: ex.visualEnergyScore,
          audioEnergyScore: ex.audioEnergyScore,
          riskScore: ex.riskScore,
          riskFlags: ex.riskFlags,
          hasViralMoment: ex.hasViralMoment,
          confidence: ex.confidence,
          rationale: ex.rationale,
        },
        // Metadata
        meta: {
          id: ex.id,
          provider: ex.provider,
          model: ex.model,
          finalScore: ex.finalScore,
          wasSelected: ex.wasSelected,
          userFeedbackLabel: ex.userFeedbackLabel,
          userFeedbackTrimStartS: ex.userFeedbackTrimStartS,
          userFeedbackTrimEndS: ex.userFeedbackTrimEndS,
          userFeedbackCreatedAt: ex.userFeedbackCreatedAt,
          estimatedCostUsd: ex.estimatedCostUsd,
          createdAt: ex.createdAt,
        },
      };
      return JSON.stringify(row);
    });

    return new NextResponse(lines.join('\n'), {
      headers: {
        'Content-Type': 'application/jsonl',
        'Content-Disposition': `attachment; filename="training-data-${new Date().toISOString().slice(0, 10)}.jsonl"`,
      },
    });
  }

  // Summary stats
  const totalCount = examples.length;
  const providerCounts: Record<string, number> = {};
  const avgConfidence =
    examples.reduce((sum, ex) => sum + (ex.confidence ?? 0), 0) / (totalCount || 1);
  const selectedCount = examples.filter((ex) => ex.wasSelected).length;
  const feedbackLabeledCount = examples.filter((ex) => ex.userFeedbackLabel != null).length;

  for (const ex of examples) {
    providerCounts[ex.provider] = (providerCounts[ex.provider] || 0) + 1;
  }

  return NextResponse.json({
    totalCount,
    selectedCount,
    feedbackLabeledCount,
    avgConfidence: Math.round(avgConfidence * 100) / 100,
    providerCounts,
    days,
    examples,
  });
}
