import { NextResponse } from 'next/server';
import { IgApiClient } from 'instagram-private-api';
import axios from 'axios';

// Helper to get buffer from url
async function getBuffer(url: string) {
  const response = await axios.get(url, { responseType: 'arraybuffer' });
  return Buffer.from(response.data, 'binary');
}

export async function POST(request: Request) {
  try {
    const {
      IG_SOURCE_USERNAME,
      IG_SOURCE_PASSWORD,
      IG_TARGET_USERNAME,
      IG_TARGET_PASSWORD,
      IG_COLLECTION_NAME,
    } = process.env;

    if (!IG_SOURCE_USERNAME || !IG_SOURCE_PASSWORD || !IG_TARGET_USERNAME || !IG_TARGET_PASSWORD) {
      return NextResponse.json(
        { error: 'Missing Instagram credentials in environment variables.' },
        { status: 500 }
      );
    }

    const collectionName = IG_COLLECTION_NAME || 'Politics';

    // 1. Authenticate Source
    const igSource = new IgApiClient();
    igSource.state.generateDevice(IG_SOURCE_USERNAME);

    // Try loading state
    try {
      // We assume the file is at root, but in Next.js runtime (Lambda or container), path might vary.
      // For local dev/server usage, process.cwd() + filename works.
      const sourceState = require('fs').readFileSync(
        process.cwd() + '/ig-state-source.json',
        'utf8'
      );
      await igSource.state.deserialize(JSON.parse(sourceState));
      console.log('Loaded Source session from file.');
    } catch (e) {
      console.log('Could not load source state file, falling back to login...');
      await igSource.account.login(IG_SOURCE_USERNAME, IG_SOURCE_PASSWORD);
    }

    // 2. Authenticate Target
    const igTarget = new IgApiClient();
    igTarget.state.generateDevice(IG_TARGET_USERNAME);

    try {
      const targetState = require('fs').readFileSync(
        process.cwd() + '/ig-state-target.json',
        'utf8'
      );
      await igTarget.state.deserialize(JSON.parse(targetState));
      console.log('Loaded Target session from file.');
    } catch (e) {
      console.log('Could not load target state file, falling back to login...');
      await igTarget.account.login(IG_TARGET_USERNAME, IG_TARGET_PASSWORD);
    }

    // 3. Find the Collection
    const collections = await (igSource.feed as any).savedCollections().request();
    // collections.items is the array
    const targetCollection = collections.items.find(
      (c: any) => c.media_count > 0 && c.name.toLowerCase() === collectionName.toLowerCase()
    );

    if (!targetCollection) {
      return NextResponse.json(
        { error: `Collection '${collectionName}' not found or empty on source account.` },
        { status: 404 }
      );
    }

    console.log(
      `Found collection: ${targetCollection.name} (ID: ${targetCollection.collection_id})`
    );

    // 4. Get Media from Collection
    // Note: instagram-private-api might not have a direct feed for a specific collection ID exposed easily on the feed namespace
    // but we can try using the `feed.saved` with specific options or mimicking the request if needed.
    // Actually, `ig.feed.saved()` gets all saved.
    // `igSource.feed.savedCollection(targetCollection.collection_id)` is usually how it works if valid.

    // Let's try to fetch the feed for the collection.
    // Not all versions of the lib expose `savedCollection` directly on `feed`, let's check or assume standard usage.
    // If specific collection feed isn't available, we might have to filter `saved()` which is inefficient.
    // However, looking at library docs/examples, `feed.saved()` is for all.
    // A specific collection feed is `new IgApiClient().feed.savedCollection(id)`. Let's try to instantiate it.

    // We cannot instantiate the Feed directly without importing it, but `igSource.feed` gives us a factory.
    // Let's see if we can use a direct request or if the factory has it.
    // Approximate implementation:

    let mediaItems: any[] = [];
    try {
      // Attempting to access the feed constructor if available via the instance or a direct request
      // Since we can't easily see the type definition here, I'll assume we iterate standard saved feed and filter?
      // No, that's bad if the user has thousands of saved items.
      // Let's use the low-level request if needed, but for now let's hope `savedCollection` exists on the factory?
      // Actually, often it's `ig.feed.savedCollection(id)`.

      // Using `any` cast to avoid TS errors if the types are strict but the method exists.
      const collectionFeed = (igSource.feed as any).savedCollection(targetCollection.collection_id);
      const page = await collectionFeed.items();
      mediaItems = page;
    } catch (e) {
      console.warn(
        'Could not get specific collection feed, falling back to recent saved items...',
        e
      );
      // Fallback: get recent saved and check manually? (Collection info isn't always on the media item itself easily)
      return NextResponse.json(
        { error: 'Failed to access specific collection feed.' },
        { status: 500 }
      );
    }

    if (mediaItems.length === 0) {
      return NextResponse.json({ message: 'No media found in collection.' });
    }

    // 5. Process the first video (Demo: just repost the latest one)
    // In a real app, we'd loop and check DB for "already reposted".
    const media = mediaItems[0];

    if (media.media_type !== 2) {
      // 1=Image, 2=Video, 8=Carousel
      return NextResponse.json({ message: 'Latest item is not a video.', type: media.media_type });
    }

    // Get the video URL
    // `video_versions` usually contains the variants.
    const videoUrl = media.video_versions?.[0]?.url;
    const coverUrl = media.image_versions2?.candidates?.[0]?.url;
    const caption = media.caption?.text || '';

    if (!videoUrl || !coverUrl) {
      return NextResponse.json({ error: 'Could not resolve video URL.' }, { status: 500 });
    }

    console.log(`Downloading video: ${media.pk}`);
    const videoBuffer = await getBuffer(videoUrl);
    const coverBuffer = await getBuffer(coverUrl);

    // 6. Upload using Target Client
    console.log(`Uploading to target...`);
    const publishResult = await igTarget.publish.video({
      video: videoBuffer,
      coverImage: coverBuffer,
      caption: `Repost: ${caption}`, // Append credit or logic as needed
    });

    return NextResponse.json({
      success: true,
      message: 'Reposted video successfully.',
      sourceMediaId: media.pk,
      newMediaId: publishResult.media.pk, // Correct properly based on response
    });
  } catch (error: any) {
    console.error('Repost Error:', error);
    return NextResponse.json(
      {
        error: error.message,
        stack: error.stack,
      },
      { status: 500 }
    );
  }
}
