import { NextResponse } from 'next/server';
import { BskyAgent, RichText } from '@atproto/api';

export async function POST(req: Request) {
  try {
    const { youtubeUrl, title, description, session } = await req.json();

    if (!session || !session.accessJwt || !session.refreshJwt || !session.handle || !session.did) {
      return NextResponse.json({ message: 'Invalid session data.' }, { status: 401 });
    }

    // ✅ Improved YouTube URL regex to support Shorts, normal, and youtu.be links
    const videoIdMatch = youtubeUrl.match(
      /(?:youtube\.com\/(?:.*[?&]v=|shorts\/)|youtu\.be\/)([^"&?\/ ]{11})/
    );

    if (!videoIdMatch) {
      return NextResponse.json({ message: 'Invalid YouTube URL format' }, { status: 400 });
    }

    const videoId = videoIdMatch[1];
    const embedUrl = `https://www.youtube.com/watch?v=${videoId}`;
    const thumbnailUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    // Resume session with full data
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.resumeSession(session);

    // Upload thumbnail and create post
    const imageResponse = await fetch(thumbnailUrl);
    const imageArrayBuffer = await imageResponse.arrayBuffer();
    const imageUint8Array = new Uint8Array(imageArrayBuffer);
    const uploadedImage = await agent.uploadBlob(imageUint8Array, { encoding: 'image/jpeg' });

    const rt = new RichText({ text: description });
    await rt.detectFacets(agent);

    // Ensure title is provided
    const videoTitle = title.trim() || 'YouTube Video';

    const post = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
      embed: {
        $type: 'app.bsky.embed.external',
        external: {
          uri: embedUrl,
          title: videoTitle,
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
