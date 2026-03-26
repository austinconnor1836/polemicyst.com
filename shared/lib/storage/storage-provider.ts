/**
 * Port interface for object storage operations.
 *
 * Abstracts storage-specific details (bucket names, regions, SDK versions)
 * behind a contract. Consumers import this interface instead of AWS SDK directly.
 */
export interface StorageProvider {
  /** Prepend the environment-specific prefix to a key path. */
  getKey(path: string): string;

  /** Strip the environment-specific prefix from a key. */
  stripPrefix(key: string): string;

  /** Delete an object by key. */
  deleteObject(key: string): Promise<void>;

  /** Generate a presigned URL for GET access. */
  getSignedUrl(key: string, expiresInSeconds: number): Promise<string>;
}

export const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
export const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
export const S3_PREFIX = process.env.S3_PREFIX || '';
