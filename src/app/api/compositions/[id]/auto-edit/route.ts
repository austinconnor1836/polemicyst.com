import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { unauthorized, badRequest, notFound, serverError, ok } from '@shared/lib/api-response';
import {
  mergeAutoEditSettings,
  getAggressivenessConfig,
  type AutoEditSettings,
  type Aggressiveness,
  type AutoEditSummary,
} from '@shared/auto-edit';
import {
  analyzeForAutoEdit,
  detectSilenceFFmpeg,
  type TranscriptSegment,
} from '@shared/util/auto-edit-analyzer';
import { downloadFeedVideoToTemp } from '@shared/util/download';

type AutoEditRequestBody = {
  settings?: Partial<AutoEditSettings>;
  apply?: boolean;
  retry?: boolean;
  triggerRender?: boolean;
  feedbackAction?: 'retry' | 'accepted';
  feedbackSource?: 'manual' | 'publish';
};

type AutoEditResultWithMeta = {
  cuts: Array<{ id: string; startS: number; endS: number; reason: string; detail: string }>;
  summary: AutoEditSummary;
  attemptNumber?: number;
  settingsUsed?: AutoEditSettings;
  generatedAt?: string;
  acceptedAt?: string;
  acceptedAttemptNumber?: number;
};

const AGGRESSIVENESS_ORDER: Aggressiveness[] = ['conservative', 'balanced', 'aggressive'];

function stepAggressiveness(current: Aggressiveness, direction: 'up' | 'down'): Aggressiveness {
  const idx = Math.max(0, AGGRESSIVENESS_ORDER.indexOf(current));
  const nextIdx =
    direction === 'up' ? Math.min(AGGRESSIVENESS_ORDER.length - 1, idx + 1) : Math.max(0, idx - 1);
  return AGGRESSIVENESS_ORDER[nextIdx];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function deriveRetrySettings(
  previousSettings: AutoEditSettings,
  previousSummary: AutoEditSummary | null
): AutoEditSettings {
  const removalRatio =
    previousSummary && previousSummary.originalDurationS > 0
      ? previousSummary.totalRemovedS / previousSummary.originalDurationS
      : 0;

  // No cuts or very weak change: push harder.
  if (!previousSummary || previousSummary.totalCuts === 0 || removalRatio < 0.05) {
    return {
      ...previousSettings,
      aggressiveness: stepAggressiveness(previousSettings.aggressiveness, 'up'),
      minSilenceToKeepS: Number(
        clamp(previousSettings.minSilenceToKeepS - 0.1, 0.15, 1.5).toFixed(2)
      ),
    };
  }

  // Too destructive: pull back.
  if (removalRatio > 0.3) {
    return {
      ...previousSettings,
      aggressiveness: stepAggressiveness(previousSettings.aggressiveness, 'down'),
      minSilenceToKeepS: Number(
        clamp(previousSettings.minSilenceToKeepS + 0.15, 0.15, 1.5).toFixed(2)
      ),
    };
  }

  // Mid-range: alternate semantic strategy by toggling bad-take detection.
  return {
    ...previousSettings,
    badTakeDetection: !previousSettings.badTakeDetection,
    minSilenceToKeepS: Number(
      clamp(
        previousSettings.minSilenceToKeepS + (previousSettings.badTakeDetection ? 0.05 : -0.05),
        0.15,
        1.5
      ).toFixed(2)
    ),
  };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let tempPath: string | null = null;

  try {
    const user = await getAuthenticatedUser(req);
    if (!user) return unauthorized();

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        creatorTranscriptJson: true,
        creatorDurationS: true,
        creatorS3Url: true,
        userId: true,
        silenceRegions: true,
        autoEditResult: true,
      },
    });

    if (!composition) return notFound('Composition not found');

    if (!composition.creatorTranscriptJson) {
      return badRequest(
        'Creator video transcript not available. Upload a creator video and wait for transcription to complete.'
      );
    }

    // Parse request body
    let body: AutoEditRequestBody = {};
    try {
      body = await req.json();
    } catch {
      // No body is fine — use defaults
    }

    // Load user's saved defaults, then overlay any per-request overrides
    const rule = await prisma.automationRule.findUnique({
      where: { userId: user.id },
      select: { autoEditSettings: true },
    });

    const savedDefaults = mergeAutoEditSettings(
      rule?.autoEditSettings as Partial<AutoEditSettings> | null
    );
    const existingResult = (composition.autoEditResult as AutoEditResultWithMeta | null) ?? null;
    const previousSummary = existingResult?.summary ?? null;

    const latestFeedback = await prisma.autoEditFeedback.findFirst({
      where: { compositionId: composition.id, userId: user.id },
      orderBy: { attemptNumber: 'desc' },
      select: {
        attemptNumber: true,
        aggressiveness: true,
        badTakeDetection: true,
        minSilenceToKeepS: true,
      },
    });

    const previousSettings = mergeAutoEditSettings({
      aggressiveness:
        (latestFeedback?.aggressiveness as Aggressiveness | undefined) ??
        existingResult?.settingsUsed?.aggressiveness ??
        savedDefaults.aggressiveness,
      badTakeDetection:
        latestFeedback?.badTakeDetection ??
        existingResult?.settingsUsed?.badTakeDetection ??
        savedDefaults.badTakeDetection,
      minSilenceToKeepS:
        latestFeedback?.minSilenceToKeepS ??
        existingResult?.settingsUsed?.minSilenceToKeepS ??
        savedDefaults.minSilenceToKeepS,
    });

    const retrySettings =
      body.retry && !body.settings ? deriveRetrySettings(previousSettings, previousSummary) : null;
    const settings = mergeAutoEditSettings({
      ...savedDefaults,
      ...(retrySettings ?? {}),
      ...(body.settings ?? {}),
    });
    const aggressivenessConfig = getAggressivenessConfig(settings.aggressiveness);

    // Parse transcript segments (still needed for bad take detection)
    const segments = composition.creatorTranscriptJson as unknown as TranscriptSegment[];
    if (!Array.isArray(segments) || segments.length === 0) {
      return badRequest('Transcript is empty or invalid');
    }

    // Derive duration from transcript when DB value is missing (client-render mode)
    const creatorDurationS =
      composition.creatorDurationS && composition.creatorDurationS > 0
        ? composition.creatorDurationS
        : (segments[segments.length - 1]?.end ?? 0);

    if (!creatorDurationS) {
      return badRequest('Cannot determine creator video duration');
    }

    // FFmpeg silencedetect — use cached regions when available, otherwise download + detect
    let ffmpegSilenceCuts: Array<{ startS: number; endS: number }> | undefined;

    const cachedRegions = composition.silenceRegions as Array<{
      startS: number;
      endS: number;
    }> | null;

    if (cachedRegions && Array.isArray(cachedRegions) && cachedRegions.length > 0) {
      ffmpegSilenceCuts = cachedRegions;
      console.log(
        `[auto-edit] Using ${cachedRegions.length} cached silence regions (instant re-analysis)`
      );
    } else if (composition.creatorS3Url) {
      try {
        tempPath = await downloadFeedVideoToTemp(composition.creatorS3Url);
        ffmpegSilenceCuts = await detectSilenceFFmpeg(
          tempPath,
          aggressivenessConfig.silenceThresholdDb,
          aggressivenessConfig.minSilenceDurationS
        );
        console.log(
          `[auto-edit] FFmpeg silencedetect found ${ffmpegSilenceCuts.length} silence regions ` +
            `(threshold=${aggressivenessConfig.silenceThresholdDb}dB, ` +
            `minDuration=${aggressivenessConfig.minSilenceDurationS}s)`
        );

        // Cache the regions for next time
        await prisma.composition.update({
          where: { id: composition.id },
          data: { silenceRegions: ffmpegSilenceCuts as any },
        });
      } catch (err) {
        console.warn(
          '[auto-edit] FFmpeg silencedetect failed, skipping audio-level detection:',
          err
        );
      }
    }

    // Run analysis (FFmpeg silence cuts + transcript-based bad take detection)
    const result = analyzeForAutoEdit(segments, settings, creatorDurationS, ffmpegSilenceCuts);
    const attemptNumber = (latestFeedback?.attemptNumber ?? 0) + 1;
    const feedbackAction =
      body.feedbackAction === 'accepted'
        ? 'accepted'
        : body.feedbackAction === 'retry' || body.retry
          ? 'retry'
          : null;
    const triggerRender = body.triggerRender ?? feedbackAction !== 'accepted';
    const acceptedAt = feedbackAction === 'accepted' ? new Date().toISOString() : undefined;
    const acceptedAttemptNumber = feedbackAction === 'accepted' ? attemptNumber : undefined;

    const resultWithMeta: AutoEditResultWithMeta = {
      ...result,
      attemptNumber,
      settingsUsed: settings,
      generatedAt: new Date().toISOString(),
      acceptedAt: acceptedAt ?? existingResult?.acceptedAt,
      acceptedAttemptNumber: acceptedAttemptNumber ?? existingResult?.acceptedAttemptNumber,
    };

    // Cache the auto-edit result and optionally persist cuts
    const updateData: Record<string, any> = {
      autoEditResult: resultWithMeta as any,
    };
    if (body.apply && result.cuts.length > 0) {
      updateData.cuts = result.cuts.map((c) => ({
        id: c.id,
        startS: c.startS,
        endS: c.endS,
      }));
    }
    await prisma.composition.update({
      where: { id: composition.id },
      data: updateData,
    });

    if (feedbackAction) {
      const actionAttemptNumber = feedbackAction === 'accepted' ? attemptNumber : attemptNumber - 1;
      await prisma.autoEditFeedback.create({
        data: {
          compositionId: composition.id,
          userId: user.id,
          action: feedbackAction,
          attemptNumber: Math.max(1, actionAttemptNumber),
          aggressiveness: settings.aggressiveness,
          badTakeDetection: settings.badTakeDetection,
          minSilenceToKeepS: settings.minSilenceToKeepS,
          minSilenceDurationS: aggressivenessConfig.minSilenceDurationS,
          silenceThresholdDb: aggressivenessConfig.silenceThresholdDb,
          totalCuts: result.summary.totalCuts,
          totalRemovedS: result.summary.totalRemovedS,
          triggerRender,
          feedbackSource: body.feedbackSource ?? 'manual',
        },
      });
    }

    return ok({
      ...resultWithMeta,
      triggerRender,
    });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/auto-edit]', err);
    return serverError('Failed to run auto-edit analysis');
  } finally {
    // Clean up temp file
    if (tempPath) {
      fs.unlink(tempPath).catch(() => {});
    }
  }
}
