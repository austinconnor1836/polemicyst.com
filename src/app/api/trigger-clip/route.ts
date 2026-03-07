import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { checkClipQuota } from '@/lib/plans';
import { triggerClipGeneration } from '@shared/services/clip-service';

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    } = await req.json();

    if (!feedVideoId) {
      return NextResponse.json({ error: 'Missing feedVideoId' }, { status: 400 });
    }

    const clipQuota = await checkClipQuota(user.id, user.subscriptionPlan);
    if (!clipQuota.allowed) {
      return NextResponse.json(
        {
          error: clipQuota.message,
          code: 'QUOTA_EXCEEDED',
          limit: clipQuota.limit,
          usage: clipQuota.currentUsage,
        },
        { status: 403 }
      );
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

    return NextResponse.json({ message: 'Clip-generation job enqueued', jobId: result.jobId });
  } catch (err) {
    console.error('Failed to enqueue job:', err);
    return NextResponse.json({ error: 'Enqueue failed' }, { status: 500 });
  }
}
