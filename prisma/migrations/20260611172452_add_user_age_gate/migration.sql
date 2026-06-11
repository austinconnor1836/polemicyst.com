-- COPPA defense (W008): add `acceptedAgeGate` to User.
-- `NULL` = grandfathered legacy user (we never asked); `TRUE` = explicit consent at signup.
-- Idempotent (`IF NOT EXISTS`) so it applies cleanly on drifted dev DBs.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "acceptedAgeGate" BOOLEAN;
