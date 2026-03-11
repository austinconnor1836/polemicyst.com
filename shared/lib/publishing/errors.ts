export type SubstackErrorCode =
  | 'auth_expired'
  | 'rate_limited'
  | 'publish_failed'
  | 'image_upload_failed'
  | 'connection_failed'
  | 'invalid_response';

export class SubstackError extends Error {
  constructor(
    public readonly code: SubstackErrorCode,
    message: string,
    public readonly statusCode?: number,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'SubstackError';
  }
}
