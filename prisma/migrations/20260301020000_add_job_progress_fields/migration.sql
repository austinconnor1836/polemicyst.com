-- AlterTable: add progress tracking fields for transcription, clip generation, and speaker transcription
ALTER TABLE "FeedVideo"
  ADD COLUMN "transcriptionStatus"   TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "transcriptionProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "transcriptionStage"    TEXT,
  ADD COLUMN "clipGenerationProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clipGenerationStage"   TEXT,
  ADD COLUMN "speakerTranscriptionStatus"   TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "speakerTranscriptionProgress" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "speakerTranscriptionStage"    TEXT;
