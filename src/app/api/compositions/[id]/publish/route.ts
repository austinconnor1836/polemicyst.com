import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { google } from 'googleapis';
import axios from 'axios';
import { Readable } from 'node:stream';

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

let s3Client: S3Client | null = null;
function getS3() {
  if (!s3Client) s3Client = new S3Client({ region: S3_REGION });
  return s3Client;
}

async function getS3Buffer(s3Key: string): Promise<Buffer> {
  const cmd = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
  const res = await getS3().send(cmd);
  const bytes = await res.Body?.transformToByteArray();
  if (!bytes) throw new Error('Empty S3 object');
  return Buffer.from(bytes);
}

function getS3Url(s3Key: string): string {
  return `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${s3Key}`;
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

type PlatformResult = {
  platform: string;
  success: boolean;
  platformUrl?: string;
  error?: string;
};

async function publishToYouTube(
  userId: string,
  s3Key: string,
  title: string,
  description: string,
  thumbnailS3Key?: string
): Promise<PlatformResult> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'google' },
    });
    if (!account?.access_token) {
      return { platform: 'youtube', success: false, error: 'Google account not connected' };
    }

    const auth = new google.auth.OAuth2();
    auth.setCredentials({ access_token: account.access_token });
    const youtube = google.youtube({ version: 'v3', auth });

    const buffer = await getS3Buffer(s3Key);
    const stream = Readable.from(buffer);

    const uploadRes = await youtube.videos.insert({
      part: ['snippet', 'status'],
      requestBody: {
        snippet: { title, description, categoryId: '25' },
        status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
      },
      media: { body: stream },
    });

    const youtubeId = uploadRes.data.id;

    // Set custom thumbnail if available
    if (thumbnailS3Key && youtubeId) {
      try {
        const thumbBuf = await getS3Buffer(thumbnailS3Key);
        await youtube.thumbnails.set({
          videoId: youtubeId,
          media: { mimeType: 'image/png', body: Readable.from(thumbBuf) },
        });
      } catch (thumbErr: any) {
        console.warn('[composition-publish] YouTube thumbnail set failed:', thumbErr.message);
        // Non-fatal — video is already uploaded
      }
    }

    return {
      platform: 'youtube',
      success: true,
      platformUrl: `https://youtu.be/${youtubeId}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] YouTube failed:', err.message);
    return { platform: 'youtube', success: false, error: err.message || 'YouTube upload failed' };
  }
}

async function publishToFacebook(
  userId: string,
  s3Key: string,
  description: string
): Promise<PlatformResult> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'facebook' },
    });
    if (!account?.access_token) {
      const googleAccount = await prisma.account.findFirst({
        where: { userId, provider: 'google' },
      });
      if (!googleAccount?.access_token) {
        return { platform: 'facebook', success: false, error: 'Facebook account not connected' };
      }
    }
    const userAccessToken =
      account?.access_token ||
      (
        await prisma.account.findFirst({
          where: { userId, provider: 'google' },
        })
      )?.access_token;

    const { data: pagesData } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );
    const page = pagesData.data?.[0];
    if (!page) {
      return { platform: 'facebook', success: false, error: 'No Facebook page found' };
    }

    const s3Url = getS3Url(s3Key);

    const { data: fbRes } = await axios.post(`https://graph.facebook.com/v19.0/${page.id}/videos`, {
      file_url: s3Url,
      description,
      access_token: page.access_token,
    });

    return {
      platform: 'facebook',
      success: true,
      platformUrl: `https://www.facebook.com/${fbRes.id}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] Facebook failed:', err.response?.data || err.message);
    return {
      platform: 'facebook',
      success: false,
      error: err.response?.data?.error?.message || err.message || 'Facebook upload failed',
    };
  }
}

async function publishToInstagram(
  userId: string,
  s3Key: string,
  description: string
): Promise<PlatformResult> {
  try {
    const fbAccount = await prisma.account.findFirst({
      where: { userId, provider: 'facebook' },
    });
    const userAccessToken = fbAccount?.access_token;
    if (!userAccessToken) {
      return {
        platform: 'instagram',
        success: false,
        error: 'Facebook/Meta account not connected',
      };
    }

    const { data: pagesData } = await axios.get(
      `https://graph.facebook.com/v19.0/me/accounts?access_token=${userAccessToken}`
    );
    const page = pagesData.data?.[0];
    if (!page) {
      return { platform: 'instagram', success: false, error: 'No Facebook page found' };
    }

    const { data: instaData } = await axios.get(
      `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
    );
    const instagramAccountId = instaData.instagram_business_account?.id;
    if (!instagramAccountId) {
      return {
        platform: 'instagram',
        success: false,
        error: 'No Instagram Business Account linked',
      };
    }

    const s3Url = getS3Url(s3Key);
    const { data: igUpload } = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media`,
      {
        media_type: 'REELS',
        video_url: s3Url,
        caption: description,
        access_token: page.access_token,
      }
    );

    const creationId = igUpload.id;
    let isReady = false;
    for (let i = 0; i < 50; i++) {
      await delay(5000);
      try {
        const { data } = await axios.get(
          `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${page.access_token}`
        );
        if (data.status_code === 'FINISHED') {
          isReady = true;
          break;
        }
      } catch {
        /* continue polling */
      }
    }

    if (!isReady) {
      return { platform: 'instagram', success: false, error: 'Instagram media processing timeout' };
    }

    const { data: publishRes } = await axios.post(
      `https://graph.facebook.com/v19.0/${instagramAccountId}/media_publish`,
      { creation_id: creationId, access_token: page.access_token }
    );

    return {
      platform: 'instagram',
      success: true,
      platformUrl: `https://www.instagram.com/reel/${publishRes.id}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] Instagram failed:', err.response?.data || err.message);
    return {
      platform: 'instagram',
      success: false,
      error: err.response?.data?.error?.message || err.message || 'Instagram upload failed',
    };
  }
}

async function publishToTwitter(
  userId: string,
  s3Key: string,
  description: string
): Promise<PlatformResult> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'twitter' },
    });
    if (!account?.access_token) {
      return { platform: 'twitter', success: false, error: 'Twitter account not connected' };
    }

    const { TwitterApi } = await import('twitter-api-v2');
    const client = new TwitterApi({
      appKey: process.env.TWITTER_CONSUMER_KEY!,
      appSecret: process.env.TWITTER_CONSUMER_SECRET!,
      accessToken: account.access_token,
      accessSecret: account.refresh_token || '',
    });

    const buffer = await getS3Buffer(s3Key);
    const mediaId = await client.readWrite.v1.uploadMedia(buffer, { type: 'video/mp4' });

    const tweet = await client.readWrite.v2.tweet({
      text: description,
      media: { media_ids: [mediaId] },
    });

    return {
      platform: 'twitter',
      success: true,
      platformUrl: `https://x.com/i/status/${tweet.data.id}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] Twitter failed:', err.message);
    return { platform: 'twitter', success: false, error: err.message || 'Twitter post failed' };
  }
}

async function publishToBluesky(userId: string, content: string): Promise<PlatformResult> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: 'bluesky' },
    });
    if (!account?.access_token || !account?.refresh_token || !account?.scope) {
      return { platform: 'bluesky', success: false, error: 'Bluesky account not connected' };
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

    const rkey = post.uri.split('/').pop();
    return {
      platform: 'bluesky',
      success: true,
      platformUrl: `https://bsky.app/profile/${account.scope}/post/${rkey}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] Bluesky failed:', err.message);
    return { platform: 'bluesky', success: false, error: err.message || 'Bluesky post failed' };
  }
}

async function publishToThreads(userId: string, content: string): Promise<PlatformResult> {
  try {
    const account = await prisma.account.findFirst({
      where: { userId, provider: { in: ['threads', 'facebook'] } },
    });
    if (!account?.access_token) {
      return { platform: 'threads', success: false, error: 'Threads/Meta account not connected' };
    }

    const createRes = await fetch('https://graph.threads.net/v1.0/me/threads', {
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
      return {
        platform: 'threads',
        success: false,
        error: createData.error?.message || 'Threads create failed',
      };
    }

    const publishRes = await fetch('https://graph.threads.net/v1.0/me/threads_publish', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        creation_id: createData.id,
        access_token: account.access_token,
      }),
    });
    const publishData = await publishRes.json();
    if (!publishRes.ok) {
      return {
        platform: 'threads',
        success: false,
        error: publishData.error?.message || 'Threads publish failed',
      };
    }

    return {
      platform: 'threads',
      success: true,
      platformUrl: `https://www.threads.net/@me/post/${publishData.id}`,
    };
  } catch (err: any) {
    console.error('[composition-publish] Threads failed:', err.message);
    return { platform: 'threads', success: false, error: err.message || 'Threads post failed' };
  }
}

const VALID_VIDEO_PLATFORMS = ['youtube', 'instagram', 'facebook', 'twitter'];
const VALID_TEXT_PLATFORMS = ['bluesky', 'threads', 'facebook', 'twitter'];
const ALL_PLATFORMS = [...new Set([...VALID_VIDEO_PLATFORMS, ...VALID_TEXT_PLATFORMS])];

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { id } = await params;

  let body: {
    platforms?: string[];
    title?: string;
    description?: string;
    descriptions?: Record<string, string>;
    outputId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { platforms, title, description, descriptions } = body;
  if (!Array.isArray(platforms) || platforms.length === 0) {
    return NextResponse.json({ error: 'At least one platform is required' }, { status: 400 });
  }
  // Need at least a base description or per-platform descriptions
  const hasBaseDesc =
    description && typeof description === 'string' && description.trim().length > 0;
  const hasPerPlatform = descriptions && typeof descriptions === 'object';
  if (!hasBaseDesc && !hasPerPlatform) {
    return NextResponse.json({ error: 'description is required' }, { status: 400 });
  }

  /** Look up the description for a given platform, falling back to the base description. */
  const getDescription = (platform: string): string => {
    if (hasPerPlatform && descriptions[platform]?.trim()) return descriptions[platform].trim();
    return (description || '').trim();
  };

  const validPlatforms = platforms.filter((p) => ALL_PLATFORMS.includes(p));
  if (validPlatforms.length === 0) {
    return NextResponse.json({ error: 'No valid platforms selected' }, { status: 400 });
  }

  const composition = await prisma.composition.findFirst({
    where: { id, userId: user.id },
    include: { outputs: true },
  });
  if (!composition) {
    return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
  }

  // Pick the best output — prefer mobile (portrait) for social, or the specific output if requested
  const completedOutputs = composition.outputs.filter((o) => o.status === 'completed' && o.s3Key);
  if (completedOutputs.length === 0) {
    return NextResponse.json(
      {
        error: 'No completed outputs with cloud uploads available. Upload renders to cloud first.',
      },
      { status: 400 }
    );
  }

  const targetOutput = body.outputId
    ? completedOutputs.find((o) => o.id === body.outputId)
    : completedOutputs.find((o) => o.layout === 'mobile') || completedOutputs[0];

  if (!targetOutput?.s3Key) {
    return NextResponse.json({ error: 'No output with S3 key found' }, { status: 400 });
  }

  // Query the selected composite thumbnail for YouTube custom thumbnail
  const thumbnail = await prisma.compositionThumbnail.findFirst({
    where: { compositionId: id, selected: true },
    select: { s3Key: true },
  });

  const videoPlatforms = validPlatforms.filter((p) => VALID_VIDEO_PLATFORMS.includes(p));
  const textOnlyPlatforms = validPlatforms.filter(
    (p) => !VALID_VIDEO_PLATFORMS.includes(p) && VALID_TEXT_PLATFORMS.includes(p)
  );

  const publishTitle = title || composition.title || 'Reaction Video';

  const results: PlatformResult[] = [];

  // Publish video platforms in parallel
  const videoPromises = videoPlatforms.map((platform) => {
    const desc = getDescription(platform);
    switch (platform) {
      case 'youtube':
        return publishToYouTube(
          user.id,
          targetOutput.s3Key!,
          publishTitle,
          desc,
          thumbnail?.s3Key ?? undefined
        );
      case 'facebook':
        return publishToFacebook(user.id, targetOutput.s3Key!, desc);
      case 'instagram':
        return publishToInstagram(user.id, targetOutput.s3Key!, desc);
      case 'twitter':
        return publishToTwitter(user.id, targetOutput.s3Key!, desc);
      default:
        return Promise.resolve({
          platform,
          success: false,
          error: 'Unknown platform',
        } as PlatformResult);
    }
  });

  const textPromises = textOnlyPlatforms.map((platform) => {
    const desc = getDescription(platform);
    switch (platform) {
      case 'bluesky':
        return publishToBluesky(user.id, desc);
      case 'threads':
        return publishToThreads(user.id, desc);
      default:
        return Promise.resolve({
          platform,
          success: false,
          error: 'Unknown platform',
        } as PlatformResult);
    }
  });

  const allResults = await Promise.allSettled([...videoPromises, ...textPromises]);
  for (const result of allResults) {
    if (result.status === 'fulfilled') {
      results.push(result.value);
    } else {
      results.push({
        platform: 'unknown',
        success: false,
        error: result.reason?.message || 'Unknown error',
      });
    }
  }

  const allSuccess = results.every((r) => r.success);
  const anySuccess = results.some((r) => r.success);

  return NextResponse.json({
    status: allSuccess ? 'completed' : anySuccess ? 'partial' : 'failed',
    results,
  });
}
