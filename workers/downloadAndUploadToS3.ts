import { spawn } from 'child_process';
import { PassThrough } from 'stream';
import AWS from 'aws-sdk';

const S3_BUCKET = 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION;

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
});

export async function downloadAndUploadToS3(videoUrl: string, videoId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const s3Key = `feeds/${videoId}.mp4`; // 👈 feeds folder inside the bucket
    const passThrough = new PassThrough();

    const yt = spawn('yt-dlp', ['-o', '-', '-f', 'mp4', videoUrl]);

    yt.stdout.pipe(passThrough);

    yt.stderr.on('data', (data) => {
      console.error(`yt-dlp stderr: ${data}`);
    });

    yt.on('error', (err) => {
      reject(new Error(`yt-dlp process failed: ${err.message}`));
    });

    yt.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    s3.upload(
      {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: passThrough,
        ContentType: 'video/mp4',
      },
      (err, data) => {
        if (err) return reject(err);
        resolve(data.Location); // e.g. https://clips-genie-uploads.s3.amazonaws.com/feeds/abc123.mp4
      }
    );
  });
}
