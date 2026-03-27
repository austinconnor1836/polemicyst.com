import { S3StorageAdapter } from './storage/s3-adapter';

export type { StorageProvider } from './storage/storage-provider';
export { S3StorageAdapter } from './storage/s3-adapter';

const storage = new S3StorageAdapter();

export function getS3Key(path: string): string {
  return storage.getKey(path);
}

export function stripS3Prefix(key: string): string {
  return storage.stripPrefix(key);
}

export async function deleteFromS3(key: string): Promise<void> {
  return storage.deleteObject(key);
}
