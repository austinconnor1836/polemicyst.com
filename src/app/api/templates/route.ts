import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { NextRequest, NextResponse } from 'next/server';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const userWithPrefs = await prisma.user.findUnique({
    where: { id: user.id },
    include: { templatePreferences: true },
  });

  if (!userWithPrefs) return new Response('User not found', { status: 404 });
  if (!userWithPrefs?.templatePreferences) {
    // Create default preferences if not set
    const preferences = await prisma.templatePreferences.create({
      data: {
        userId: user.id,
        facebookTemplate: '',
        instagramTemplate: '',
        youtubeTemplate: '',
        sharedPostscript: '',
      },
    });
    return Response.json(preferences);
  }

  return Response.json(userWithPrefs.templatePreferences);
}

export async function PUT(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();

  const {
    facebookTemplate,
    instagramTemplate,
    youtubeTemplate,
    sharedPostscript = '', // ✅ provide a fallback if undefined
  } = body;

  const updated = await prisma.templatePreferences.upsert({
    where: { userId: user.id },
    update: {
      facebookTemplate,
      instagramTemplate,
      youtubeTemplate,
      sharedPostscript,
    },
    create: {
      userId: user.id,
      facebookTemplate,
      instagramTemplate,
      youtubeTemplate,
      sharedPostscript,
    },
  });

  return Response.json(updated);
}
