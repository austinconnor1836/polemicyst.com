import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { runDataDropAutomation } from '@shared/lib/data-drop-automation';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const publication = await prisma.publication.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const result = await runDataDropAutomation({
      publicationId: publication.id,
      dryRun: true,
    });

    return NextResponse.json({
      publicationId: publication.id,
      testedAt: new Date().toISOString(),
      dryRun: true,
      result,
    });
  } catch (err) {
    console.error('[POST /api/publications/:id/data-sources/test] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to run data source test' }, { status: 500 });
  }
}
