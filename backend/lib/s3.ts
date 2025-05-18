import { S3 } from 'aws-sdk';
import { readFile } from 'fs/promises';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

const S3_BUCKET_NAME = 'clips-genie-uploads';

const s3 = new S3({
  region: process.env.AWS_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
});

/**
 * Upload a local file to S3
 * @param localPath - Full path to the local file
 * @param s3Key - Desired S3 object key (e.g., clips/video123/clip1.mp4)
 * @returns Object with public S3 URL and key
 */
export async function uploadToS3(
  localPath: string,
  s3Key: string
): Promise<{ url: string; key: string }> {
  const fileContent = await readFile(localPath);

  await s3
    .putObject({
      Bucket: S3_BUCKET_NAME,
      Key: s3Key,
      Body: fileContent,
      ContentType: getMimeType(localPath),
    })
    .promise();

  return {
    url: `https://${S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`,
    key: s3Key,
  };
}

/**
 * Infer content type based on file extension (for S3 uploads)
 */
function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.srt') return 'application/x-subrip';
  return 'application/octet-stream';
}
