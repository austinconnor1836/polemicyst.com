// /src/app/api/feeds/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';

export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    await prisma.videoFeed.delete({
      where: { id: params.id },
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('Failed to delete feed:', err);
    return NextResponse.json({ error: 'Failed to delete feed' }, { status: 500 });
  }
}
