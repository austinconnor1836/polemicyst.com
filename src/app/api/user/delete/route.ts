import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { unauthorized, serverError } from '@shared/lib/api-response';

/**
 * POST /api/user/delete
 *
 * GDPR "right to erasure" — cascade-deletes EVERYTHING owned by the
 * authenticated user. Idempotent: re-calling after deletion is a no-op
 * (the auth check will simply fail with 401, since the user no longer
 * exists in the DB).
 *
 * Most user-owned tables already have `onDelete: Cascade` wired through
 * the User relation (Account, Session, Video, VideoFeed, FeedVideo,
 * Brand, AutomationRule, ClipCropTemplate, TemplatePreferences, Publication,
 * PublishingAccount, UploadLog, SocialPost, Composition, UsageMonth, ...).
 * Their child rows (Segment, Clip, Metric, SegmentRhetoricLabel, JobLog,
 * TruthAnalysis, AnalysisChat, AnalysisChatMessage, CompositionTrack,
 * CompositionOutput, CompositionThumbnail, ThumbnailAsset, Article,
 * ArticleGraphic, ArticlePublish, SocialPostPublish) cascade in turn from
 * those parents.
 *
 * Three tables track `userId` as a plain string WITHOUT a FK relation —
 * `CostEvent`, `TrainingExample`, `TruthTrainingExample` — so they would
 * be left orphaned if we relied on cascade alone. We delete them explicitly
 * inside a single transaction with the User delete so the operation is
 * atomic.
 */
export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return unauthorized();
  }

  try {
    await prisma.$transaction([
      // Manual deletes — no FK relation to User, so no cascade fires.
      prisma.costEvent.deleteMany({ where: { userId: user.id } }),
      prisma.trainingExample.deleteMany({ where: { userId: user.id } }),
      prisma.truthTrainingExample.deleteMany({ where: { userId: user.id } }),

      // Everything else cascades via the User relation.
      prisma.user.delete({ where: { id: user.id } }),
    ]);

    return new NextResponse(null, { status: 204 });
  } catch (err) {
    return serverError('Failed to delete user data', err);
  }
}
