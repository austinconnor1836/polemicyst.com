-- AlterTable
ALTER TABLE "Composition" ADD COLUMN     "creatorTranscript" TEXT,
ADD COLUMN     "creatorTranscriptJson" JSONB;

-- AlterTable
ALTER TABLE "CompositionOutput" ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptJson" JSONB;

-- AlterTable
ALTER TABLE "CompositionTrack" ADD COLUMN     "transcript" TEXT,
ADD COLUMN     "transcriptJson" JSONB;
