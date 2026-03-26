import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { trimClipFromS3 } from '@shared/util/ffmpegUtils';

export const runtime = 'nodejs';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clip = await prisma.video.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      s3Url: true,
      trimStartS: true,
      trimEndS: true,
      sourceVideo: { select: { s3Url: true } },
    },
  });
  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  const inputUrl = clip.sourceVideo?.s3Url || clip.s3Url;
  if (!inputUrl) {
    return NextResponse.json({ error: 'Source video missing' }, { status: 400 });
  }
  if (clip.trimStartS == null || clip.trimEndS == null) {
    return NextResponse.json({ error: 'Trim points are not set.' }, { status: 400 });
  }
  if (clip.trimEndS <= clip.trimStartS) {
    return NextResponse.json({ error: 'Trim end must be after start.' }, { status: 400 });
  }

  const exportKey = `exports/${clip.id}/${Date.now()}.mp4`;

  try {
    const trimmed = await trimClipFromS3(inputUrl, clip.trimStartS, clip.trimEndS, exportKey);
    return NextResponse.json(trimmed);
  } catch (err) {
    console.error('Export trim failed:', err);
    return NextResponse.json({ error: 'Failed to export trimmed clip.' }, { status: 500 });
  }
}
