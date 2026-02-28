-- Add per-user default LLM provider flag (defaults to Gemini when unspecified)
ALTER TABLE "User"
ADD COLUMN IF NOT EXISTS "defaultLLMProvider" TEXT NOT NULL DEFAULT 'gemini';
