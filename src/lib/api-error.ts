export interface ApiQuotaError {
  error: string;
  code: 'QUOTA_EXCEEDED' | 'PLAN_RESTRICTED';
  limit?: number;
  usage?: number;
  allowedProviders?: string[];
}

export function isQuotaErrorCode(code: string): code is ApiQuotaError['code'] {
  return code === 'QUOTA_EXCEEDED' || code === 'PLAN_RESTRICTED';
}

export async function parseApiError(res: Response): Promise<ApiQuotaError | null> {
  if (res.status !== 403) return null;
  try {
    const body = await res.json();
    if (body?.code && isQuotaErrorCode(body.code)) {
      return body as ApiQuotaError;
    }
  } catch {
    // response body isn't JSON or is malformed
  }
  return null;
}
