-- Composite index for the GET /api/clips query, which orders by createdAt within a user.
-- Without this, large-account clips listings did a sequential scan and could exceed 120s.
CREATE INDEX IF NOT EXISTS "Video_userId_createdAt_idx" ON "Video"("userId", "createdAt");
