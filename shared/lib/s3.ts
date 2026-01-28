import AWS from 'aws-sdk';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({ region: S3_REGION });

export async function deleteFromS3(key: string): Promise<void> {
  if (!key) return;
  await s3.deleteObject({ Bucket: S3_BUCKET, Key: key }).promise();
}
