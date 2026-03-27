import {
  S3Client,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { StorageProvider } from './storage-provider';
import { S3_BUCKET, S3_REGION, S3_PREFIX } from './storage-provider';

let client: S3Client | null = null;

function getClient(): S3Client {
  if (!client) {
    client = new S3Client({ region: S3_REGION });
  }
  return client;
}

export class S3StorageAdapter implements StorageProvider {
  getKey(path: string): string {
    if (!path) return '';
    const cleanPath = path.startsWith('/') ? path.slice(1) : path;
    if (S3_PREFIX && !cleanPath.startsWith(S3_PREFIX + '/')) {
      return `${S3_PREFIX}/${cleanPath}`;
    }
    return cleanPath;
  }

  stripPrefix(key: string): string {
    if (!key || !S3_PREFIX) return key;
    const prefix = `${S3_PREFIX}/`;
    if (key.startsWith(prefix)) {
      return key.slice(prefix.length);
    }
    return key;
  }

  async deleteObject(key: string): Promise<void> {
    if (!key) return;
    const s3Key = this.getKey(key);
    await getClient().send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
    );
  }

  async getSignedUrl(key: string, expiresInSeconds: number): Promise<string> {
    const s3Key = this.getKey(key);
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
    return awsGetSignedUrl(getClient(), command, { expiresIn: expiresInSeconds });
  }
}
