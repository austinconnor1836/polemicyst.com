import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { BskyAgent, RichText } from '@atproto/api';

const prisma = new PrismaClient();

export async function POST(req: Request) {
  try {
    const { youtubeUrl, description, userId } = await req.json();

    if (!userId) {
      return NextResponse.json({ message: 'Missing user ID.' }, { status: 400 });
    }

    // ✅ Fetch Bluesky session details from DB
    const account = await prisma.account.findFirst({
      where: {
        userId,
        provider: 'bluesky',
      },
    });

    if (!account || !account.access_token || !account.refresh_token || !account.scope) {
      return NextResponse.json({ message: 'Bluesky session not found or incomplete.' }, { status: 401 });
    }

    const session = {
      accessJwt: account.access_token,
      refreshJwt: account.refresh_token,
      handle: account.providerAccountId,
      did: account.scope, // ✅ DID stored in the 'scope' field
      active: true,
    };

    // ✅ Extract YouTube video ID
    const videoIdMatch = youtubeUrl.match(
      /(?:youtube\.com\/(?:.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/ ]{11})/
    );

    if (!videoIdMatch) {
      return NextResponse.json({ message: 'Invalid YouTube URL format' }, { status: 400 });
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // ✅ Fetch title from YouTube API
    const youtubeRes = await fetch(`https://www.youtube.com/oembed?url=${embedUrl}&format=json`);
    if (!youtubeRes.ok) {
      return NextResponse.json({ message: 'Failed to fetch YouTube title' }, { status: 500 });
    }
    const youtubeData = await youtubeRes.json();
    const title = youtubeData.title || 'YouTube Video';

    // ✅ Resume session
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.resumeSession(session);

    // ✅ Upload thumbnail image
    const imageResponse = await fetch(thumbnailUrl);
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageUint8Array = new Uint8Array(imageArrayBuffer);
    const uploadedImage = await agent.uploadBlob(imageUint8Array, { encoding: 'image/jpeg' });

    const rt = new RichText({ text: description });
    await rt.detectFacets(agent);

    const post = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: embedUrl,
          title: title,
          description: '',
          thumb: uploadedImage.data.blob,
        },
      },
    });

    return NextResponse.json({ message: 'Posted successfully!', post }, { status: 200 });

  } catch (error) {
    console.error('Error posting to Bluesky:', error);
    return NextResponse.json({ message: 'Failed to post', error }, { status: 500 });
  }
}
