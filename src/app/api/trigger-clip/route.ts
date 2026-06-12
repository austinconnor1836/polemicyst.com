import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { checkUploadMinutesQuota } from '@/lib/plans';
import { triggerClipGeneration } from '@shared/services/clip-service';
import { applyLimit, createLimiter } from '@/lib/rate-limit';
import { prisma } from '@shared/lib/prisma';
import { flushServerPostHog, getServerPostHog } from '@/lib/posthog';

const triggerClipLimiter = createLimiter({
  tokens: 30,
  window: '1 m',
  prefix: 'rl:trigger-clip',
});

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const limited = await applyLimit(req, user.id, triggerClipLimiter);
    if (limited) return limited;

    const {
      feedVideoId,
      aspectRatio,
      scoringMode,
      includeAudio,
      saferClips,
      targetPlatform,
      contentStyle,
      minCandidates,
      maxCandidates,
      minScore,
      percentile,
      maxGeminiCandidates,
      llmProvider,
      clipLength,
      showTimestamp,
      captionsEnabled,
      captionFont,
      captionFontSize,
    } = await req.json();

    if (!feedVideoId) {
      return NextResponse.json({ error: 'Missing feedVideoId' }, { status: 400 });
    }

    const minutesQuota = await checkUploadMinutesQuota(user.id, user.subscriptionPlan);
    if (!minutesQuota.allowed) {
      return NextResponse.json(
        {
          error: minutesQuota.message,
          code: 'QUOTA_EXCEEDED',
          limit: minutesQuota.limit,
          usage: minutesQuota.currentUsage,
        },
        { status: 403 }
      );
    }

    // W013: detect whether this is the user's first generated clip BEFORE we
    // enqueue. A clip is any Video row where `sourceVideoId IS NOT NULL`.
    // If the count is 0 right now, this request will produce their first clip.
    let isFirstClip = false;
    const posthog = getServerPostHog();
    if (posthog) {
      try {
        const existingClipCount = await prisma.video.count({
          where: { userId: user.id, sourceVideoId: { not: null } },
        });
        isFirstClip = existingClipCount === 0;
      } catch {
        // Best-effort — never block clip generation on analytics.
      }
    }

    const result = await triggerClipGeneration({
      feedVideoId,
      userId: user.id,
      aspectRatio,
      scoringMode,
      includeAudio,
      saferClips,
      targetPlatform,
      contentStyle,
      minCandidates,
      maxCandidates,
      minScore,
      percentile,
      maxGeminiCandidates,
      llmProvider,
      clipLength,
      showTimestamp,
      captionsEnabled,
      captionFont,
      captionFontSize,
    });

    if (result.status === 'already_running') {
      return NextResponse.json({
        message: 'Clip generation already in progress',
        jobId: result.jobId,
      });
    }

    if (result.status === 'locked') {
      return NextResponse.json({ message: 'Job is locked or stuck', jobId: result.jobId });
    }

    // W013: fire `first_clip_generated` only when this was actually the
    // user's first enqueue (status !== already_running/locked).
    if (isFirstClip && posthog) {
      try {
        posthog.capture({
          distinctId: user.id,
          event: 'first_clip_generated',
          properties: {
            feed_video_id: feedVideoId,
            job_id: result.jobId,
            target_platform: targetPlatform ?? undefined,
            scoring_mode: scoringMode ?? undefined,
          },
        });
        await flushServerPostHog();
      } catch {
        // Non-fatal.
      }
    }

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: result.jobId });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
