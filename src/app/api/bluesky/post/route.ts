import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { BskyAgent, RichText } from '@atproto/api';

const prisma = new PrismaClient();

// Wait for YouTube to generate a real thumbnail (max 5 min)
async function waitForValidThumbnail(videoId: string, maxRetries = 60, interval = 5000): Promise<string | null> {
  const tryUrls = [
    `https://img.youtube.com/vi/${videoId}/maxresdefault.jpg`,
    `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
  ];
  const minExpectedSizeBytes = 10_000;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    for (const url of tryUrls) {
      try {
        const res = await fetch(url);
        const buffer = await res.arrayBuffer();
        if (res.ok && buffer.byteLength > minExpectedSizeBytes) {
          console.log(`✅ Found valid thumbnail: ${url} (${buffer.byteLength} bytes)`);
          return url;
        } else {
          console.log(`⏳ Thumbnail still processing: ${url} (${buffer.byteLength} bytes)`);
        }
      } catch (err) {
        console.warn(`⚠️ Error fetching thumbnail from ${url}:`, err);
      }
    }

    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  console.warn('⚠️ Thumbnail not available after extended polling.');
  return null;
}

export async function POST(req: Request) {
  try {
    const { youtubeUrl, description, userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: 'Missing user ID.' }, { status: 400 });
    }

    const account = await prisma.account.findFirst({
      where: { userId, provider: 'bluesky' },
    });

    if (!account || !account.access_token || !account.refresh_token || !account.scope) {
      return NextResponse.json({ message: 'Bluesky session not found or incomplete.' }, { status: 401 });
    }

    const session = {
      accessJwt: account.access_token,
      refreshJwt: account.refresh_token,
      handle: account.providerAccountId,
      did: account.scope,
      active: true,
    };

    // Extract video ID
    const videoIdMatch = youtubeUrl.match(
      /(?:youtube\.com\/(?:.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/ ]{11})/
    );

    if (!videoIdMatch) {
      return NextResponse.json({ message: 'Invalid YouTube URL format' }, { status: 400 });
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `https://www.youtube.com/watch?v=${videoId}`;

    // Wait up to 5 minutes for real thumbnail
    const thumbnailUrl = await waitForValidThumbnail(videoId);

    // Fetch title using YouTube oEmbed
    const youtubeRes = await fetch(`https://www.youtube.com/oembed?url=${embedUrl}&format=json`);
    if (!youtubeRes.ok) {
      return NextResponse.json({ message: 'Failed to fetch YouTube title' }, { status: 500 });
    }

    const youtubeData = await youtubeRes.json();
    const title = youtubeData.title || 'YouTube Video';

    // Resume Bluesky session
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.resumeSession(session);

    // Upload thumbnail if available
    let uploadedImage = null;
    if (thumbnailUrl) {
      const imageResponse = await fetch(thumbnailUrl);
      const imageArrayBuffer = await imageResponse.arrayBuffer();
      const imageUint8Array = new Uint8Array(imageArrayBuffer);
      uploadedImage = await agent.uploadBlob(imageUint8Array, { encoding: 'image/jpeg' });
    }

    // Format post text
    const rt = new RichText({ text: description });
    await rt.detectFacets(agent);

    // Create embed object
    const embedPayload: any = {
      uri: embedUrl,
      title,
      description: '',
    };

    if (uploadedImage) {
      embedPayload.thumb = uploadedImage.data.blob;
    }

    // Post to Bluesky
    const post = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      embed: {
        $type: 'app.bsky.embed.external',
        external: embedPayload,
      },
    });

    return NextResponse.json({ message: 'Posted to Bluesky successfully!', post }, { status: 200 });

  } catch (error) {
    console.error('❌ Error posting to Bluesky:', error);
    return NextResponse.json({ message: 'Failed to post', error: error instanceof Error ? error.message : error }, { status: 500 });
  }
}
