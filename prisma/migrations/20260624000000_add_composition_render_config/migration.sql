-- AlterTable
-- Adds a render manifest column for the stitch-render worker. The manifest is
-- the full instruction set the worker needs to reproduce a stitch render
-- (style, clip refs, overlays, cutout) without re-reading the iOS draft.
-- Kept Json? to parallel `cuts` / `detectedQuotes` / `autoEditResult`.
ALTER TABLE "Composition" ADD COLUMN IF NOT EXISTS "renderConfig" JSONB;
