-- AutomationRule.autoGeneratePublishMeta: when true, the Publish sheet runs AI on open.
ALTER TABLE "AutomationRule" ADD COLUMN IF NOT EXISTS "autoGeneratePublishMeta" BOOLEAN NOT NULL DEFAULT false;
