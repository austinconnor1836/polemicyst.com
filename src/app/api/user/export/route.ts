import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { unauthorized, serverError } from '@shared/lib/api-response';

/**
 * POST /api/user/export
 *
 * GDPR "right of access / data portability" — returns a JSON dump of
 * everything we hold about the authenticated user. Mirrors the surface
 * area of `/api/user/delete` so the two endpoints stay in lock-step.
 *
 * Response is `application/json` with a `Content-Disposition: attachment`
 * header so browser clients save it as a file. Prisma BigInt fields
 * (`CostEvent.fileSizeBytes`, `CompositionOutput.fileSizeBytes`) are
 * coerced to strings for safe JSON transport.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return unauthorized();
  }

  try {
    const userId = user.id;

    // Pull all user-owned rows. We fetch nested children explicitly rather
    // than relying on Prisma `include` everywhere — keeps the JSON shape
    // flat and predictable, and makes the per-table coverage easy to audit.
    const [
      accounts,
      sessions,
      templatePreferences,
      clipCropTemplates,
      videoFeeds,
      feedVideos,
      videos,
      segments,
      clips,
      compositions,
      compositionTracks,
      compositionOutputs,
      compositionThumbnails,
      thumbnailAssets,
      brands,
      automationRule,
      publications,
      articles,
      articleGraphics,
      articlePublishes,
      publishingAccounts,
      uploadLogs,
      socialPosts,
      socialPostPublishes,
      costEvents,
      jobLogs,
      trainingExamples,
      truthTrainingExamples,
      truthAnalyses,
      analysisChats,
      analysisChatMessages,
      usageMonths,
    ] = await Promise.all([
      prisma.account.findMany({ where: { userId } }),
      prisma.session.findMany({ where: { userId } }),
      prisma.templatePreferences.findUnique({ where: { userId } }),
      prisma.clipCropTemplate.findMany({ where: { userId } }),
      prisma.videoFeed.findMany({ where: { userId } }),
      prisma.feedVideo.findMany({ where: { userId } }),
      prisma.video.findMany({ where: { userId } }),
      prisma.segment.findMany({ where: { video: { userId } } }),
      prisma.clip.findMany({ where: { segment: { video: { userId } } } }),
      prisma.composition.findMany({ where: { userId } }),
      prisma.compositionTrack.findMany({
        where: { composition: { userId } },
      }),
      prisma.compositionOutput.findMany({
        where: { composition: { userId } },
      }),
      prisma.compositionThumbnail.findMany({
        where: { composition: { userId } },
      }),
      prisma.thumbnailAsset.findMany({
        where: { composition: { userId } },
      }),
      prisma.brand.findMany({ where: { userId } }),
      prisma.automationRule.findUnique({ where: { userId } }),
      prisma.publication.findMany({ where: { userId } }),
      prisma.article.findMany({ where: { userId } }),
      prisma.articleGraphic.findMany({
        where: { article: { userId } },
      }),
      prisma.articlePublish.findMany({
        where: { article: { userId } },
      }),
      prisma.publishingAccount.findMany({ where: { userId } }),
      prisma.uploadLog.findMany({ where: { userId } }),
      prisma.socialPost.findMany({ where: { userId } }),
      prisma.socialPostPublish.findMany({
        where: { socialPost: { userId } },
      }),
      prisma.costEvent.findMany({ where: { userId } }),
      prisma.jobLog.findMany({ where: { feedVideo: { userId } } }),
      prisma.trainingExample.findMany({ where: { userId } }),
      prisma.truthTrainingExample.findMany({ where: { userId } }),
      prisma.truthAnalysis.findMany({ where: { userId } }),
      prisma.analysisChat.findMany({ where: { userId } }),
      prisma.analysisChatMessage.findMany({
        where: { chat: { userId } },
      }),
      prisma.usageMonth.findMany({ where: { userId } }),
    ]);

    const dump = {
      exportedAt: new Date().toISOString(),
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: user.emailVerified,
        image: user.image,
        subscriptionPlan: user.subscriptionPlan,
        stripeCustomerId: user.stripeCustomerId,
        defaultLLMProvider: user.defaultLLMProvider,
        defaultPublishPlatforms: user.defaultPublishPlatforms,
      },
      accounts,
      sessions,
      templatePreferences,
      clipCropTemplates,
      videoFeeds,
      feedVideos,
      videos,
      segments,
      clips,
      compositions,
      compositionTracks,
      compositionOutputs,
      compositionThumbnails,
      thumbnailAssets,
      brands,
      automationRule,
      publications,
      articles,
      articleGraphics,
      articlePublishes,
      publishingAccounts,
      uploadLogs,
      socialPosts,
      socialPostPublishes,
      costEvents,
      jobLogs,
      trainingExamples,
      truthTrainingExamples,
      truthAnalyses,
      analysisChats,
      analysisChatMessages,
      usageMonths,
    };

    // JSON.stringify chokes on bigint — coerce to string. Known bigint fields:
    // CostEvent.fileSizeBytes, CompositionOutput.fileSizeBytes.
    const body = JSON.stringify(dump, (_key, value) =>
      typeof value === 'bigint' ? value.toString() : value
    );

    const datestamp = new Date().toISOString().slice(0, 10);
    return new NextResponse(body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': `attachment; filename="clipfire-export-${userId}-${datestamp}.json"`,
      },
    });
  } catch (err) {
    return serverError('Failed to export user data', err);
  }
}
