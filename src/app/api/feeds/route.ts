// src/app/api/feeds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../auth'; // adjust path if needed

function detectSourceType(sourceUrlRaw: string): 'youtube' | 'cspan' {
  const trimmed = (sourceUrlRaw || '').trim();
  let lower = trimmed.toLowerCase();

  // Accept URLs missing protocol (e.g. "www.youtube.com/@handle")
  if (lower && !lower.startsWith('http://') && !lower.startsWith('https://')) {
    lower = `https://${lower}`;
  }

  // Use a permissive check (we don't want a strict URL parse to block common copy/paste).
  if (
    lower.includes('youtube.com') ||
    lower.includes('youtu.be') ||
    lower.includes('youtube-nocookie.com') ||
    lower.includes('m.youtube.com')
  ) {
    return 'youtube';
  }

  if (lower.includes('c-span.org') || lower.includes('cspan')) {
    return 'cspan';
  }

  throw new Error('UNSUPPORTED_SOURCE');
}

export async function GET() {
  const feeds = await prisma.videoFeed.findMany({
    orderBy: { createdAt: 'desc' },
  });
  return NextResponse.json(feeds);
}

export async function POST(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
  });

  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const data = await req.json();
  const { name, sourceUrl, pollingInterval } = data;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }
  if (!sourceUrl || !String(sourceUrl).trim()) {
    return NextResponse.json({ error: 'Source URL is required' }, { status: 400 });
  }

  let sourceType: 'youtube' | 'cspan';
  try {
    sourceType = detectSourceType(String(sourceUrl));
  } catch (e) {
    return NextResponse.json(
      {
        error:
          'Unsupported feed URL. Currently supported sources are YouTube and C-SPAN. Please paste a channel/playlist URL.',
      },
      { status: 400 }
    );
  }

  const intervalNum = Number(pollingInterval);
  const safePollingInterval = Number.isFinite(intervalNum) ? Math.max(1, Math.floor(intervalNum)) : 60;

  const newFeed = await prisma.videoFeed.create({
    data: {
      name: String(name).trim(),
      sourceUrl: String(sourceUrl).trim(),
      pollingInterval: safePollingInterval,
      sourceType,
      userId: user.id, // ✅ required
    },
  });

  return NextResponse.json(newFeed);
}
