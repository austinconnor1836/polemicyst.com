import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  const data = await req.json();
  const { name, imageUrl } = data;

  const updated = await prisma.brand.update({
    where: { id },
    data: {
      ...(typeof name === 'string' && name.trim() && { name: name.trim() }),
      ...(imageUrl !== undefined && { imageUrl: imageUrl ? String(imageUrl).trim() : null }),
    },
    include: { _count: { select: { videoFeeds: true } } },
  });

  return NextResponse.json(updated);
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const brand = await prisma.brand.findUnique({ where: { id } });
  if (!brand || brand.userId !== user.id) {
    return NextResponse.json({ error: 'Brand not found' }, { status: 404 });
  }

  // Feeds will have brandId set to null via onDelete: SetNull
  await prisma.brand.delete({ where: { id } });

  return NextResponse.json({ success: true });
}
