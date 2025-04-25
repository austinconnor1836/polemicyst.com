// src/app/api/feeds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';

export async function GET() {
  const feeds = await prisma.videoFeed.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(feeds);
}

export async function POST(req: Request) {
  const data = await req.json();
  const { name, sourceUrl, pollingInterval } = data;

  let sourceType: 'youtube' | 'cspan' | 'other' = 'other';
  const lowerUrl = sourceUrl.toLowerCase();

  if (lowerUrl.includes('youtube.com')) {
    sourceType = 'youtube';
  } else if (lowerUrl.includes('c-span.org') || lowerUrl.includes('cspan')) {
    sourceType = 'cspan';
  }

  const newFeed = await prisma.videoFeed.create({
    data: {
      name,
      sourceUrl,
      pollingInterval,
      sourceType, // ✅ Now sourceType is always set
    },
  });

  return Response.json(newFeed);
}

