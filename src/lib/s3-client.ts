import { S3Client } from '@aws-sdk/client-s3';
import AWS from 'aws-sdk';

export const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
export const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const useAccelerate = process.env.S3_TRANSFER_ACCELERATION === 'true';

const credentials =
  process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
    ? {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      }
    : undefined;

/** AWS SDK v3 S3Client (used by most multipart routes) */
export function makeS3v3Client(): S3Client {
  return new S3Client({
    region: S3_REGION,
    ...(credentials ? { credentials } : {}),
    ...(useAccelerate ? { useAccelerateEndpoint: true } : {}),
  });
}

/** AWS SDK v2 S3 (used for getSignedUrlPromise) */
export function makeS3v2Client(): AWS.S3 {
  return new AWS.S3({
    accessKeyId: credentials?.accessKeyId,
    secretAccessKey: credentials?.secretAccessKey,
    region: S3_REGION,
    signatureVersion: 'v4',
    ...(useAccelerate ? { useAccelerateEndpoint: true } : {}),
  });
}
