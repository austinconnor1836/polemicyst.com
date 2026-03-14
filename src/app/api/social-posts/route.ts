import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

const VALID_PLATFORMS = ['twitter', 'facebook', 'bluesky', 'threads'];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const posts = await prisma.socialPost.findMany({
    where: { userId: user.id },
    include: { publishes: true },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });

  return NextResponse.json(posts);
}

async function publishToTwitter(
  userId: string,
  content: string
): Promise<{
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'twitter' },
    });
    if (!account?.access_token) {
      return { success: false, error: 'Twitter account not connected' };
    }

    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY!,
      appSecret: process.env.TWITTER_CONSUMER_SECRET!,
      accessToken: account.access_token,
      accessSecret: account.refresh_token || '',
    });

    const tweet = await client.readWrite.v2.tweet({ text: content });
    return {
      success: true,
      platformPostId: tweet.data.id,
      platformUrl: `https://x.com/i/status/${tweet.data.id}`,
    };
  } catch (err: any) {
    console.error('[social-posts] Twitter publish failed:', err);
    return { success: false, error: err.message || 'Twitter publish failed' };
  }
}

async function publishToBluesky(
  userId: string,
  content: string
): Promise<{
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'bluesky' },
    });
    if (!account?.access_token || !account?.refresh_token || !account?.scope) {
      return { success: false, error: 'Bluesky account not connected' };
    }

    const { BskyAgent, RichText } = await import('@atproto/api');
    const agent = new BskyAgent({ service: 'https://bsky.social' });
    await agent.resumeSession({
      accessJwt: account.access_token,
      refreshJwt: account.refresh_token,
      handle: account.providerAccountId,
      did: account.scope,
      active: true,
    });

    const rt = new RichText({ text: content });
    await rt.detectFacets(agent);

    const post = await agent.post({
      text: rt.text,
      facets: rt.facets,
      createdAt: new Date().toISOString(),
    });

    const postUri = post.uri;
    const did = account.scope;
    const rkey = postUri.split('/').pop();
    const platformUrl = `https://bsky.app/profile/${did}/post/${rkey}`;

    return { success: true, platformPostId: postUri, platformUrl };
  } catch (err: any) {
    console.error('[social-posts] Bluesky publish failed:', err);
    return { success: false, error: err.message || 'Bluesky publish failed' };
  }
}

async function publishToFacebook(
  userId: string,
  content: string
): Promise<{
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'facebook' },
    });
    if (!account?.access_token) {
      return { success: false, error: 'Facebook account not connected' };
    }

    const res = await fetch(`https://graph.facebook.com/v19.0/me/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: content,
        access_token: account.access_token,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      return { success: false, error: data.error?.message || 'Facebook API error' };
    }

    return {
      success: true,
      platformPostId: data.id,
      platformUrl: `https://www.facebook.com/${data.id}`,
    };
  } catch (err: any) {
    console.error('[social-posts] Facebook publish failed:', err);
    return { success: false, error: err.message || 'Facebook publish failed' };
  }
}

async function publishToThreads(
  userId: string,
  content: string
): Promise<{
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: { in: ['threads', 'facebook'] } },
    });
    if (!account?.access_token) {
      return { success: false, error: 'Threads/Meta account not connected' };
    }

    // Step 1: Create a media container
    const createRes = await fetch(`https://graph.threads.net/v1.0/me/threads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        media_type: 'TEXT',
        text: content,
        access_token: account.access_token,
      }),
    });
    const createData = await createRes.json();
    if (!createRes.ok) {
      return { success: false, error: createData.error?.message || 'Threads create failed' };
    }

    // Step 2: Publish
    const publishRes = await fetch(`https://graph.threads.net/v1.0/me/threads_publish`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: account.access_token,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return { success: false, error: publishData.error?.message || 'Threads publish failed' };
    }

    return {
      success: true,
      platformPostId: publishData.id,
      platformUrl: `https://www.threads.net/@me/post/${publishData.id}`,
    };
  } catch (err: any) {
    console.error('[social-posts] Threads publish failed:', err);
    return { success: false, error: err.message || 'Threads publish failed' };
  }
}

type PublishFn = (
  userId: string,
  content: string
) => Promise<{
  success: boolean;
  platformPostId?: string;
  platformUrl?: string;
  error?: string;
}>;

const publishHandlers: Record<string, PublishFn> = {
  twitter: publishToTwitter,
  bluesky: publishToBluesky,
  facebook: publishToFacebook,
  threads: publishToThreads,
};

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { content?: string; platforms?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { content, platforms } = body;
  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    return NextResponse.json({ error: 'content is required' }, { status: 400 });
  }
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'At least one platform is required' }, { status: 400 });
  }

  const validPlatforms = platforms.filter((p) => VALID_PLATFORMS.includes(p));
  if (validPlatforms.length === 0) {
    return NextResponse.json({ error: 'No valid platforms selected' }, { status: 400 });
  }

  const post = await prisma.socialPost.create({
    data: {
      userId: user.id,
      content: content.trim(),
      platforms: validPlatforms,
      status: 'publishing',
      publishes: {
        create: validPlatforms.map((p) => ({
          platform: p,
          status: 'pending',
        })),
      },
    },
    include: { publishes: true },
  });

  const results = await Promise.allSettled(
    validPlatforms.map(async (platform) => {
      const handler = publishHandlers[platform];
      if (!handler) {
        return { platform, success: false, error: `Unsupported platform: ${platform}` };
      }
      const result = await handler(user.id, content.trim());
      return { platform, ...result };
    })
  );

  let allSucceeded = true;
  let anySucceeded = false;

  for (const result of results) {
    if (result.status === 'rejected') continue;
    const { platform, success, platformPostId, platformUrl, error } = result.value;

    await prisma.socialPostPublish.update({
      where: {
        socialPostId_platform: { socialPostId: post.id, platform },
      },
      data: {
        status: success ? 'published' : 'failed',
        platformPostId: platformPostId || null,
        platformUrl: platformUrl || null,
        publishError: error || null,
        publishedAt: success ? new Date() : null,
      },
    });

    if (success) anySucceeded = true;
    else allSucceeded = false;
  }

  const finalStatus = allSucceeded ? 'completed' : anySucceeded ? 'completed' : 'failed';
  const updatedPost = await prisma.socialPost.update({
    where: { id: post.id },
    data: { status: finalStatus },
    include: { publishes: true },
  });

  return NextResponse.json(updatedPost, { status: 201 });
}
