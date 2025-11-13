import { spawn } from 'child_process';
import { PassThrough, pipeline as streamPipeline } from 'stream';
import { promisify } from 'util';
import AWS from 'aws-sdk';

const S3_BUCKET = 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION;

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
});

const pipeline = promisify(streamPipeline);


export async function downloadAndUploadToS3(videoUrl: string, videoId: string | null): Promise<string> {
  if (!videoId) {
    throw new Error('videoId is required for S3 upload');
  }
  const s3Key = `feeds/${videoId}.mp4`;
  const passThrough = new PassThrough();
  // Add yt-dlp workaround for JS runtime warning
  const ytArgs = ['-o', '-', '-f', 'mp4', '--extractor-args', 'youtube:player_client=default', videoUrl];
  const yt = spawn('yt-dlp', ytArgs);

  // Collect stderr for better error reporting
  let ytDlpStderr = '';
  yt.stderr.on('data', (data) => {
    const msg = data.toString();
    ytDlpStderr += msg;
    console.error(`yt-dlp stderr: ${msg}`);
  });

  // Handle yt-dlp process errors
  yt.on('error', (err) => {
    passThrough.destroy();
  });

  // Timeout after 10 minutes (configurable)
  const timeoutMs = 10 * 60 * 1000;
  let timeout: NodeJS.Timeout | null = setTimeout(() => {
    yt.kill('SIGKILL');
    passThrough.destroy(new Error('yt-dlp download timed out'));
  }, timeoutMs);

  try {
    // Use pipeline for robust error handling
    const uploadPromise = s3.upload({
      Bucket: S3_BUCKET,
      Key: s3Key,
      Body: passThrough,
      ContentType: 'video/mp4',
    }).promise();

    // Pipe yt-dlp stdout to S3 upload
    await pipeline(yt.stdout, passThrough);

    // Wait for yt-dlp to exit
    const exitCode: number = await new Promise((resolve) => {
      yt.on('close', resolve);
    });
    if (exitCode !== 0) {
      throw new Error(`yt-dlp exited with code ${exitCode}: ${ytDlpStderr}`);
    }

    // Wait for S3 upload to finish
    const data = await uploadPromise;
    return data.Location;
  } catch (err: any) {
    yt.kill('SIGKILL');
    passThrough.destroy();
    throw err;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
