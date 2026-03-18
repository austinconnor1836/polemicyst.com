import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      select: {
        id: true,
        status: true,
        outputs: {
          select: {
            id: true,
            layout: true,
            status: true,
            s3Url: true,
            renderError: true,
            durationMs: true,
            fileSizeBytes: true,
          },
        },
      },
    });

    if (!composition) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    return NextResponse.json(composition);
  } catch (err) {
    console.error('[GET /api/compositions/[id]/render/status]', err);
    return NextResponse.json({ error: 'Failed to get render status' }, { status: 500 });
  }
}
