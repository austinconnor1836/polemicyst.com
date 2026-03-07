import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import AWS from 'aws-sdk';

export const maxDuration = 120;

const S3_BUCKET = process.env.S3_BUCKET || 'clips-genie-uploads';
const S3_REGION = process.env.S3_REGION || process.env.AWS_REGION || 'us-east-1';

const s3 = new AWS.S3({
  region: S3_REGION,
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  signatureVersion: 'v4',
});

type PlatformInput = {
  title?: string;
  description: string;
};

type PlatformResult = {
  success: boolean;
  url?: string;
  id?: string;
  error?: string;
};

async function publishToYouTube(
  clip: { s3Key: string },
  content: PlatformInput,
  accessToken: string
): Promise<PlatformResult> {
  const { google } = await import('googleapis');
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  const youtube = google.youtube({ version: 'v3', auth });

  const s3Stream = s3.getObject({ Bucket: S3_BUCKET, Key: clip.s3Key }).createReadStream();
  const res = await youtube.videos.insert({
    part: ['snippet', 'status'],
    requestBody: {
      snippet: {
        title: content.title || 'Untitled',
        description: content.description,
        categoryId: '25',
      },
      status: { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    },
    media: { body: s3Stream },
  });

  const videoId = res.data.id;
  return { success: true, url: `https://youtu.be/${videoId}`, id: videoId || undefined };
}

async function publishToFacebook(
  clip: { s3Key: string; fileName?: string | null },
  content: PlatformInput,
  accessToken: string
): Promise<PlatformResult> {
  const axios = (await import('axios')).default;
  const FormData = (await import('form-data')).default;

  const { data: pagesData } = await axios.get(
    `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
  );
  const page = pagesData.data?.[0];
  if (!page) return { success: false, error: 'No Facebook Page found' };

  const s3Stream = s3.getObject({ Bucket: S3_BUCKET, Key: clip.s3Key }).createReadStream();
  const form = new FormData();
  form.append('description', content.description);
  form.append('access_token', page.access_token);
  form.append('source', s3Stream, { filename: clip.fileName || 'clip.mp4' });

  const res = await axios.post(`https://graph.facebook.com/v19.0/${page.id}/videos`, form, {
    headers: form.getHeaders(),
  });

  return { success: true, id: res.data.id };
}

async function publishToInstagram(
  clip: { s3Key: string },
  content: PlatformInput,
  accessToken: string
): Promise<PlatformResult> {
  const axios = (await import('axios')).default;

  const { data: pagesData } = await axios.get(
    `https://graph.facebook.com/v19.0/me/accounts?access_token=${accessToken}`
  );
  const page = pagesData.data?.[0];
  if (!page) return { success: false, error: 'No Facebook Page found' };

  const { data: instaData } = await axios.get(
    `https://graph.facebook.com/v19.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token}`
  );
  const igId = instaData.instagram_business_account?.id;
  if (!igId) return { success: false, error: 'No Instagram Business Account linked' };

  const s3Url = `https://${S3_BUCKET}.s3.${S3_REGION}.amazonaws.com/${clip.s3Key}`;
  const createRes = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media`, {
    media_type: 'REELS',
    video_url: s3Url,
    caption: content.description,
    access_token: page.access_token,
  });

  const creationId = createRes.data.id;
  let ready = false;
  for (let i = 0; i < 50; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    try {
      const check = await axios.get(
        `https://graph.facebook.com/v19.0/${creationId}?fields=status_code&access_token=${page.access_token}`
      );
      if (check.data.status_code === 'FINISHED') {
        ready = true;
        break;
      }
    } catch {}
  }
  if (!ready) return { success: false, error: 'Instagram media processing timed out' };

  const pubRes = await axios.post(`https://graph.facebook.com/v19.0/${igId}/media_publish`, {
    creation_id: creationId,
    access_token: page.access_token,
  });

  return { success: true, id: pubRes.data.id };
}

async function publishToBluesky(
  content: PlatformInput,
  account: {
    access_token: string;
    refresh_token: string;
    providerAccountId: string;
    scope: string;
  }
): Promise<PlatformResult> {
  const { BskyAgent, RichText } = await import('@atproto/api');

  const agent = new BskyAgent({ service: 'https://bsky.social' });
  await agent.resumeSession({
    accessJwt: account.access_token,
    refreshJwt: account.refresh_token,
    handle: account.providerAccountId,
    did: account.scope,
    active: true,
  });

  const rt = new RichText({ text: content.description });
  await rt.detectFacets(agent);

  await agent.post({
    text: rt.text,
    facets: rt.facets,
    createdAt: new Date().toISOString(),
  });

  return { success: true, url: `https://bsky.app/profile/${account.providerAccountId}` };
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const clip = await prisma.video.findUnique({
    where: { id },
    select: { id: true, userId: true, s3Key: true, s3Url: true, fileName: true },
  });

  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }
  if (!clip.s3Key) {
    return NextResponse.json({ error: 'Clip has no video file' }, { status: 400 });
  }

  const body = await req.json();
  const platforms: Record<string, PlatformInput> = body.platforms || {};

  if (Object.keys(platforms).length === 0) {
    return NextResponse.json({ error: 'No platforms selected' }, { status: 400 });
  }

  const results: Record<string, PlatformResult> = {};

  for (const platform of Object.keys(platforms)) {
    const content = platforms[platform];
    try {
      if (platform === 'youtube') {
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'google' },
        });
        if (!account?.access_token) {
          results.youtube = { success: false, error: 'Google account not connected' };
          continue;
        }
        results.youtube = await publishToYouTube(
          { s3Key: clip.s3Key! },
          content,
          account.access_token
        );
      } else if (platform === 'facebook') {
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'facebook' },
        });
        if (!account?.access_token) {
          results.facebook = { success: false, error: 'Facebook account not connected' };
          continue;
        }
        results.facebook = await publishToFacebook(
          { s3Key: clip.s3Key!, fileName: clip.fileName },
          content,
          account.access_token
        );
      } else if (platform === 'instagram') {
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'facebook' },
        });
        if (!account?.access_token) {
          results.instagram = {
            success: false,
            error: 'Facebook/Instagram account not connected',
          };
          continue;
        }
        results.instagram = await publishToInstagram(
          { s3Key: clip.s3Key! },
          content,
          account.access_token
        );
      } else if (platform === 'bluesky') {
        const account = await prisma.account.findFirst({
          where: { userId: user.id, provider: 'bluesky' },
        });
        if (!account?.access_token || !account?.refresh_token || !account?.scope) {
          results.bluesky = { success: false, error: 'Bluesky account not connected' };
          continue;
        }
        results.bluesky = await publishToBluesky(content, {
          access_token: account.access_token,
          refresh_token: account.refresh_token,
          providerAccountId: account.providerAccountId,
          scope: account.scope,
        });
      } else {
        results[platform] = { success: false, error: `Platform "${platform}" is not supported` };
      }
    } catch (err: any) {
      console.error(`[publish] ${platform} failed:`, err?.response?.data || err?.message || err);
      results[platform] = {
        success: false,
        error: err?.message || `Failed to publish to ${platform}`,
      };
    }
  }

  return NextResponse.json({ results });
}
