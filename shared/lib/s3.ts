import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';
const S3_PREFIX = process.env.S3_PREFIX || '';

const s3 = new AWS.S3({ region: S3_REGION });

/**
 * Prepends the environment-specific S3 prefix to a key path.
 * This ensures files are stored in the correct folder (prod/ or dev/).
 *
 * @param path - The relative path (e.g., "videos/abc123.mp4")
 * @returns The full S3 key with prefix (e.g., "prod/videos/abc123.mp4")
 */
export function getS3Key(path: string): string {
  if (!path) return '';
  // Remove leading slash if present
  const cleanPath = path.startsWith('/') ? path.slice(1) : path;
  // Don't add prefix if path already starts with it
  if (S3_PREFIX && !cleanPath.startsWith(S3_PREFIX + '/')) {
    return `${S3_PREFIX}/${cleanPath}`;
  }
  return cleanPath;
}

/**
 * Removes the environment-specific S3 prefix from a key.
 * Useful for displaying paths to users without the prefix.
 *
 * @param key - The full S3 key (e.g., "prod/videos/abc123.mp4")
 * @returns The path without prefix (e.g., "videos/abc123.mp4")
 */
export function stripS3Prefix(key: string): string {
  if (!key || !S3_PREFIX) return key;
  const prefix = `${S3_PREFIX}/`;
  if (key.startsWith(prefix)) {
    return key.slice(prefix.length);
  }
  return key;
}

export async function deleteFromS3(key: string): Promise<void> {
  if (!key) return;
  // Apply prefix if not already present
  const s3Key = getS3Key(key);
  await s3.deleteObject({ Bucket: S3_BUCKET, Key: s3Key }).promise();
}
