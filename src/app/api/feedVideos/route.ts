// src/app/api/feedVideos/route.ts
import { prisma } from '@shared/lib/prisma';
import { NextResponse } from 'next/server';

export async function GET() {
  const videos = await prisma.feedVideo.findMany({
    orderBy: { createdAt: 'desc' },
    include: { feed: true }
  });
  return NextResponse.json(videos);
}
