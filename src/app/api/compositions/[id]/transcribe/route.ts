import { NextRequest } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { mergeAutoEditSettings, getAggressivenessConfig } from '@shared/auto-edit';
import { analyzeForAutoEdit, type TranscriptSegment } from '@shared/util/auto-edit-analyzer';
import { unauthorized, notFound, badRequest, serverError, ok } from '@shared/lib/api-response';

/**
 * POST /api/compositions/[id]/transcribe?action=save
 *
 * Saves transcription results (from the worker) to the composition in DB.
 * The actual file upload goes directly to the worker via Next.js rewrite
 * (/api/worker/transcribe → http://localhost:3001/transcribe).
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: { id: true, cuts: true },
    });

    if (!composition) return notFound('Composition not found');

    const result = await req.json();

    if (!result.transcript || !result.segments) {
      return badRequest('Missing transcript or segments');
    }

    const updateData: Record<string, any> = {
      creatorTranscript: result.transcript,
      creatorTranscriptJson: result.segments,
    };

    // Client-render mode sends creator metadata alongside transcript
    if (result.creatorDurationS != null) updateData.creatorDurationS = result.creatorDurationS;
    if (result.creatorWidth != null) updateData.creatorWidth = result.creatorWidth;
    if (result.creatorHeight != null) updateData.creatorHeight = result.creatorHeight;

    if (result.silenceRegions) {
      updateData.silenceRegions = result.silenceRegions;
    }

    if (result.autoEditResult) {
      updateData.autoEditResult = result.autoEditResult;

      // Auto-apply cuts if none exist
      if (result.autoEditResult.cuts?.length > 0 && !composition.cuts) {
        updateData.cuts = result.autoEditResult.cuts.map(
          (c: { id: string; startS: number; endS: number }) => ({
            id: c.id,
            startS: c.startS,
            endS: c.endS,
          })
        );
      }

      if (result.autoEditResult.attemptNumber != null) {
        updateData.autoEditAttemptNumber = result.autoEditResult.attemptNumber;
      }
    } else if (
      result.silenceRegions &&
      Array.isArray(result.silenceRegions) &&
      result.segments &&
      Array.isArray(result.segments)
    ) {
      // Compute and persist an initial auto-edit result for the UI even when worker
      // doesn't return precomputed analysis.
      const rule = await prisma.automationRule.findUnique({
        where: { userId: user.id },
        select: { autoEditSettings: true },
      });
      const settings = mergeAutoEditSettings(rule?.autoEditSettings as any);
      const aggressiveness = getAggressivenessConfig(settings.aggressiveness);
      const autoEditResult = analyzeForAutoEdit(
        result.segments as TranscriptSegment[],
        settings,
        result.creatorDurationS ?? result.segments[result.segments.length - 1]?.end ?? 0,
        result.silenceRegions
      );

      updateData.autoEditResult = autoEditResult;

      if (autoEditResult.cuts?.length > 0 && !composition.cuts) {
        updateData.cuts = autoEditResult.cuts.map((c) => ({
          id: c.id,
          startS: c.startS,
          endS: c.endS,
        }));
      }

      await prisma.autoEditFeedback.create({
        data: {
          compositionId: composition.id,
          userId: user.id,
          action: 'accepted',
          attemptNumber: 1,
          aggressiveness: settings.aggressiveness,
          badTakeDetection: settings.badTakeDetection,
          minSilenceToKeepS: settings.minSilenceToKeepS,
          minSilenceDurationS: aggressiveness.minSilenceDurationS,
          silenceThresholdDb: aggressiveness.silenceThresholdDb,
          totalCuts: autoEditResult.summary.totalCuts,
          totalRemovedS: autoEditResult.summary.totalRemovedS,
          triggerRender: false,
          feedbackSource: 'manual',
        },
      });
    }

    const updated = await prisma.composition.update({
      where: { id },
      data: updateData,
      select: {
        creatorTranscript: true,
        creatorTranscriptJson: true,
        silenceRegions: true,
        autoEditResult: true,
        cuts: true,
      },
    });

    return ok(updated);
  } catch (err) {
    console.error('[POST /api/compositions/[id]/transcribe]', err);
    return serverError('Failed to transcribe');
  }
}
