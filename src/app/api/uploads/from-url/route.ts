import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { queueFeedDownloadJob } from '@shared/queues';
import { findOrCreateManualFeed, createFeedVideoRecord } from '@shared/services/upload-service';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { url, filename } = await req.json();

    if (!url || !String(url).startsWith('http')) {
      return NextResponse.json({ error: 'Invalid URL' }, { status: 400 });
    }

    const manualFeed = await findOrCreateManualFeed(user.id);

    const newVideo = await createFeedVideoRecord({
      feedId: manualFeed.id,
      userId: user.id,
      title: filename || url.split('/').pop() || 'Imported Video',
      s3Url: url,
      status: 'pending',
    });

    await queueFeedDownloadJob({
      feedVideoId: newVideo.id,
      url,
      title: newVideo.title,
      feedId: manualFeed.id,
      userId: user.id,
    });

    return NextResponse.json(newVideo);
  } catch (error) {
    console.error('Import from URL error:', error);
    return NextResponse.json({ error: 'Failed to register video' }, { status: 500 });
  }
}
