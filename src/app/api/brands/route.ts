import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brands = await prisma.brand.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    include: { _count: { select: { videoFeeds: true } } },
  });

  return NextResponse.json(brands);
}

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const data = await req.json();
  const { name, imageUrl } = data;

  if (!name || !String(name).trim()) {
    return NextResponse.json({ error: 'Name is required' }, { status: 400 });
  }

  const brand = await prisma.brand.create({
    data: {
      name: String(name).trim(),
      imageUrl: imageUrl ? String(imageUrl).trim() : null,
      userId: user.id,
    },
    include: { _count: { select: { videoFeeds: true } } },
  });

  return NextResponse.json(brand);
}
