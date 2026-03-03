import type { QuotaErrorInfo } from '@/components/UpgradePrompt';

/**
 * Parse a fetch Response into a QuotaErrorInfo if it's a 403 with a recognized
 * error code. Returns null for non-quota errors.
 */
export async function parseQuotaError(res: Response): Promise<QuotaErrorInfo | null> {
  if (res.status !== 403) return null;

  try {
    const body = await res.json();
    if (body?.code === 'QUOTA_EXCEEDED' || body?.code === 'PLAN_RESTRICTED') {
      return {
        code: body.code,
        error: body.error || 'You have reached your plan limit.',
        limit: body.limit,
        usage: body.usage,
        allowedProviders: body.allowedProviders,
      };
    }
  } catch {
    // JSON parse failed — treat as generic error
  }

  return null;
}
