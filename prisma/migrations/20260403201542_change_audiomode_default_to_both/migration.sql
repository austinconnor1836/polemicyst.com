-- Change default audioMode from 'creator' to 'both' so reference audio is included
ALTER TABLE "Composition" ALTER COLUMN "audioMode" SET DEFAULT 'both';

-- Update existing compositions that still have the old default
UPDATE "Composition" SET "audioMode" = 'both' WHERE "audioMode" = 'creator';
