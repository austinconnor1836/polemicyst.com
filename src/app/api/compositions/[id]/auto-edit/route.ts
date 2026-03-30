import { NextRequest } from 'next/server';
import fs from 'fs/promises';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { unauthorized, badRequest, notFound, serverError, ok } from '@shared/lib/api-response';
import {
  mergeAutoEditSettings,
  getAggressivenessConfig,
  type AutoEditSettings,
} from '@shared/auto-edit';
import {
  analyzeForAutoEdit,
  detectSilenceFFmpeg,
  type TranscriptSegment,
} from '@shared/util/auto-edit-analyzer';
import { downloadFeedVideoToTemp } from '@shared/util/download';

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
      },
    });

    if (!composition) return notFound('Composition not found');

    if (!composition.creatorTranscriptJson || !composition.creatorDurationS) {
      return badRequest(
        'Creator video transcript not available. Upload a creator video and wait for transcription to complete.'
      );
    }

    // Parse request body
    let body: { settings?: Partial<AutoEditSettings>; apply?: boolean } = {};
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
    const settings = mergeAutoEditSettings({ ...savedDefaults, ...(body.settings ?? {}) });
    const aggressivenessConfig = getAggressivenessConfig(settings.aggressiveness);

    // Parse transcript segments (still needed for bad take detection)
    const segments = composition.creatorTranscriptJson as unknown as TranscriptSegment[];
    if (!Array.isArray(segments) || segments.length === 0) {
      return badRequest('Transcript is empty or invalid');
    }

    // FFmpeg silencedetect — download creator video and analyze waveform
    let ffmpegSilenceCuts: Array<{ startS: number; endS: number }> | undefined;

    if (composition.creatorS3Url) {
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
      } catch (err) {
        console.warn(
          '[auto-edit] FFmpeg silencedetect failed, skipping audio-level detection:',
          err
        );
        // Continue without FFmpeg cuts — bad take detection still runs
      }
    }

    // Run analysis (FFmpeg silence cuts + transcript-based bad take detection)
    const result = analyzeForAutoEdit(
      segments,
      settings,
      composition.creatorDurationS,
      ffmpegSilenceCuts
    );

    // Optionally persist cuts to the composition
    if (body.apply && result.cuts.length > 0) {
      await prisma.composition.update({
        where: { id: composition.id },
        data: {
          cuts: result.cuts.map((c) => ({
            id: c.id,
            startS: c.startS,
            endS: c.endS,
          })),
        },
      });
    }

    return ok(result);
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
