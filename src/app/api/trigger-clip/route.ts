import { NextRequest, NextResponse } from 'next/server';
import { Queue } from 'bullmq';

const connection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: 6379,
};

type ClipJob = {
  videoId: string;
  s3Url: string;
};

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ClipJob;

  if (!body.videoId || !body.s3Url) {
    return NextResponse.json({ error: 'Missing videoId or s3Url' }, { status: 400 });
  }

  const queue = new Queue('clip-jobs', { connection });

  await queue.add('generateClip', body);

  return NextResponse.json({ message: 'Job enqueued', job: body });
}
