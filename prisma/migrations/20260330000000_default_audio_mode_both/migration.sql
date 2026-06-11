-- Change default audioMode from "creator" to "both"
ALTER TABLE "Composition" ALTER COLUMN "audioMode" SET DEFAULT 'both';

-- Update existing compositions that still use "creator" to "both"
UPDATE "Composition" SET "audioMode" = 'both' WHERE "audioMode" = 'creator';
