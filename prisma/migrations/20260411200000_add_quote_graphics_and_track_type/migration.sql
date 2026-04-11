-- Adds quote graphics fields (AutomationRule, Composition) and CompositionTrack.trackType.
-- These columns were previously applied to dev databases via `prisma db push` without
-- a corresponding migration. This file backfills the migration history. Uses IF NOT EXISTS
-- so it is safe on databases where the columns were already created.

ALTER TABLE "AutomationRule"
  ADD COLUMN IF NOT EXISTS "quoteGraphicsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "quoteGraphicStyle" TEXT NOT NULL DEFAULT 'pull-quote';

ALTER TABLE "Composition"
  ADD COLUMN IF NOT EXISTS "detectedQuotes" JSONB,
  ADD COLUMN IF NOT EXISTS "quoteGraphicStyle" TEXT,
  ADD COLUMN IF NOT EXISTS "quoteGraphicsEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "CompositionTrack"
  ADD COLUMN IF NOT EXISTS "trackType" TEXT NOT NULL DEFAULT 'reference';
