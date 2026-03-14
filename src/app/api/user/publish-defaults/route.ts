import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

const VALID_PLATFORMS = ['twitter', 'facebook', 'bluesky', 'threads'];

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const platforms = (user.defaultPublishPlatforms as string[] | null) ?? [];
  return NextResponse.json({ platforms });
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { platforms?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if (!Array.isArray(body.platforms)) {
    return NextResponse.json({ error: 'platforms must be an array of strings' }, { status: 400 });
  }

  const filtered = body.platforms.filter((p) => VALID_PLATFORMS.includes(p));

  await prisma.user.update({
    where: { id: user.id },
    data: { defaultPublishPlatforms: filtered },
  });

  return NextResponse.json({ platforms: filtered });
}
