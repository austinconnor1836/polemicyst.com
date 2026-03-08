import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

const OLLAMA_BASE_URL = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(
  /\/$/,
  ''
);
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'llama3';

interface PlatformContent {
  title?: string;
  description: string;
  hashtags: string;
}

interface ComposeResult {
  youtube: PlatformContent;
  facebook: PlatformContent;
  instagram: PlatformContent;
  bluesky: PlatformContent;
  twitter: PlatformContent;
}

async function generateWithAI(transcript: string, existingTitle: string): Promise<ComposeResult> {
  const prompt = `You are a social media marketing expert. Given a video transcript, generate optimized post content for each platform.

Rules:
- YouTube: title (max 100 chars, clickbait-style), description (max 500 chars), 5-8 hashtags
- Facebook: description (max 500 chars, engaging), 3-5 hashtags
- Instagram: caption (max 300 chars, emoji-friendly), 10-15 hashtags
- Bluesky: short post (max 250 chars), 2-3 hashtags
- Twitter/X: tweet (max 250 chars), 2-3 hashtags

Return ONLY valid JSON:
{
  "youtube": { "title": "...", "description": "...", "hashtags": "..." },
  "facebook": { "description": "...", "hashtags": "..." },
  "instagram": { "description": "...", "hashtags": "..." },
  "bluesky": { "description": "...", "hashtags": "..." },
  "twitter": { "description": "...", "hashtags": "..." }
}

Transcript:
"""
${transcript.slice(0, 8000)}
"""`;

  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.7 },
    }),
    signal: AbortSignal.timeout(30000),
  });

  if (!res.ok) throw new Error(`Ollama error: ${res.status}`);
  const data = await res.json();
  const parsed = JSON.parse(data.response);

  return {
    youtube: {
      title: parsed.youtube?.title || existingTitle,
      description: parsed.youtube?.description || '',
      hashtags: parsed.youtube?.hashtags || '',
    },
    facebook: {
      description: parsed.facebook?.description || '',
      hashtags: parsed.facebook?.hashtags || '',
    },
    instagram: {
      description: parsed.instagram?.description || '',
      hashtags: parsed.instagram?.hashtags || '',
    },
    bluesky: {
      description: parsed.bluesky?.description || '',
      hashtags: parsed.bluesky?.hashtags || '',
    },
    twitter: {
      description: parsed.twitter?.description || '',
      hashtags: parsed.twitter?.hashtags || '',
    },
  };
}

function generateFromTemplate(
  title: string,
  description: string,
  transcript: string
): ComposeResult {
  const snippet = transcript.slice(0, 200).trim();
  const hook = snippet ? snippet.split(/[.!?]/)[0]?.trim() || snippet : '';

  const baseDesc = description || hook || title;
  const shortDesc = baseDesc.length > 250 ? baseDesc.slice(0, 247) + '...' : baseDesc;
  const tweetDesc = baseDesc.length > 230 ? baseDesc.slice(0, 227) + '...' : baseDesc;

  const defaultHashtags = '#viral #clips #video #trending #content';
  const shortHashtags = '#viral #clips #trending';

  return {
    youtube: {
      title: title.length > 100 ? title.slice(0, 97) + '...' : title,
      description: baseDesc,
      hashtags: defaultHashtags,
    },
    facebook: {
      description: baseDesc,
      hashtags: defaultHashtags,
    },
    instagram: {
      description: shortDesc,
      hashtags: defaultHashtags + ' #reels #explore #fyp',
    },
    bluesky: {
      description: shortDesc,
      hashtags: shortHashtags,
    },
    twitter: {
      description: tweetDesc,
      hashtags: shortHashtags,
    },
  };
}

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
      videoTitle: true,
      sharedDescription: true,
      transcript: true,
      s3Url: true,
      s3Key: true,
      feedVideo: { select: { transcript: true, title: true } },
      sourceVideo: { select: { transcript: true, videoTitle: true } },
    },
  });

  if (!clip) {
    return NextResponse.json({ error: 'Clip not found' }, { status: 404 });
  }
  if (clip.userId !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const accounts = await prisma.account.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });
  const providers = new Set(accounts.map((a) => a.provider));

  const transcript =
    clip.transcript || clip.feedVideo?.transcript || clip.sourceVideo?.transcript || '';
  const title = clip.videoTitle || clip.feedVideo?.title || 'Untitled Clip';
  const description = clip.sharedDescription || '';

  let content: ComposeResult;
  let aiGenerated = false;

  if (transcript) {
    try {
      content = await generateWithAI(transcript, title);
      aiGenerated = true;
    } catch {
      content = generateFromTemplate(title, description, transcript);
    }
  } else {
    content = generateFromTemplate(title, description, transcript);
  }

  return NextResponse.json({
    clip: { id: clip.id, title, s3Url: clip.s3Url },
    aiGenerated,
    connected: {
      youtube: providers.has('google'),
      facebook: providers.has('facebook'),
      instagram: providers.has('facebook'),
      bluesky: providers.has('bluesky'),
      twitter: providers.has('twitter'),
    },
    content,
  });
}
