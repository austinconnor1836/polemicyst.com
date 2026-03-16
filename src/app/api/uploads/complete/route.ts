import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { getClipGenerationQueue, queueTranscriptionJob } from '@shared/queues';
import { checkClipQuota } from '@/lib/plans';
import {
  getStrictnessConfig,
  mergeViralitySettings,
  type ViralitySettingsValue,
} from '@shared/virality';
import { findOrCreateManualFeed, createFeedVideoRecord } from '@shared/services/upload-service';
import { logJob } from '@shared/lib/job-logger';
import { logUpload, getUploadContext } from '@shared/lib/upload-logger';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const startMs = Date.now();
  const { userAgent } = getUploadContext(req);

  try {
    const { key, filename } = await req.json();

    console.info(
      `[upload:register] user=${user.id} email=${user.email} key=${key} filename=${filename}`
    );

    const manualFeed = await findOrCreateManualFeed(user.id);
    const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${key}`;

    const newVideo = await createFeedVideoRecord({
      feedId: manualFeed.id,
      userId: user.id,
      title: filename || 'Untitled Upload',
      s3Url,
      status: 'ready',
    });

    const durationMs = Date.now() - startMs;

    await logUpload({
      userId: user.id,
      stage: 'register',
      status: 'success',
      filename,
      key,
      durationMs,
      userAgent,
      metadata: { feedVideoId: newVideo.id, feedId: manualFeed.id },
    });

    console.info(
      `[upload:register] SUCCESS user=${user.id} feedVideoId=${newVideo.id} key=${key} (${durationMs}ms)`
    );

    try {
      await queueTranscriptionJob({ feedVideoId: newVideo.id });
      await logJob({
        feedVideoId: newVideo.id,
        jobType: 'transcription',
        status: 'queued',
        message: 'Transcription auto-queued after file upload',
      });
      console.info(`[upload:register] Transcription queued for ${newVideo.id} (${filename})`);
    } catch (err) {
      console.warn('[upload:register] Failed to queue transcription (non-fatal):', err);
    }

    if (manualFeed.autoGenerateClips && manualFeed.viralitySettings) {
      const clipQuota = await checkClipQuota(user.id, user.subscriptionPlan);
      if (!clipQuota.allowed) {
        console.warn(`[upload:register] Clip quota exceeded for user ${user.id}. Skipping.`);
      } else {
        try {
          const rawSettings = manualFeed.viralitySettings as Partial<ViralitySettingsValue>;
          const settings = mergeViralitySettings(rawSettings);
          const strictnessConfig = getStrictnessConfig(settings.strictnessPreset);

          const queue = getClipGenerationQueue();
          await queue.add(
            'clip-generation',
            {
              feedVideoId: newVideo.id,
              userId: user.id,
              aspectRatio: '9:16',
              scoringMode: settings.scoringMode || 'hybrid',
              includeAudio: settings.includeAudio || false,
              saferClips: settings.saferClips ?? true,
              targetPlatform: settings.targetPlatform || 'reels',
              contentStyle: settings.contentStyle || 'auto',
              llmProvider: settings.llmProvider,
              ...strictnessConfig,
            },
            { jobId: newVideo.id, removeOnComplete: true, removeOnFail: true }
          );
        } catch (err) {
          console.error('[upload:register] Failed to enqueue clip-generation:', err);
        }
      }
    }

    return NextResponse.json(newVideo);
  } catch (error) {
    const durationMs = Date.now() - startMs;
    const errMsg = error instanceof Error ? error.message : String(error);

    await logUpload({
      userId: user.id,
      stage: 'register',
      status: 'failed',
      durationMs,
      error: errMsg,
      userAgent,
      metadata: { stack: error instanceof Error ? error.stack : undefined },
    });

    console.error(`[upload:register] FAILED user=${user.id} error=${errMsg} (${durationMs}ms)`);
    return NextResponse.json(
      { error: 'Failed to register upload', detail: errMsg },
      { status: 500 }
    );
  }
}
