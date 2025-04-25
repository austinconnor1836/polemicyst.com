// src/app/api/feeds/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';

export async function GET() {
  const feeds = await prisma.videoFeed.findMany({ orderBy: { createdAt: 'desc' } });
  return NextResponse.json(feeds);
}

export async function POST(req: NextRequest) {
  const data = await req.json();
  const { name, sourceUrl, pollingInterval } = data;

  const newFeed = await prisma.videoFeed.create({
    data: { name, sourceUrl, pollingInterval },
  });

  return NextResponse.json(newFeed);
}
