import { getServerSession } from 'next-auth';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@shared/lib/prisma';
import { authOptions } from '../../../../auth';

const DEFAULT_TEMPLATES = [
  {
    name: 'Full frame 9:16',
    aspectRatio: '9:16',
  },
  {
    name: 'Full frame 1:1',
    aspectRatio: '1:1',
  },
  {
    name: 'Full frame 16:9',
    aspectRatio: '16:9',
  },
];

const isValidAspect = (value: string) => value === '9:16' || value === '1:1' || value === '16:9';

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const existingCount = await prisma.clipCropTemplate.count({
    where: { userId: user.id },
  });

  if (existingCount === 0) {
    await prisma.clipCropTemplate.createMany({
      data: DEFAULT_TEMPLATES.map((template) => ({
        userId: user.id,
        name: template.name,
        aspectRatio: template.aspectRatio,
        cropX: 0,
        cropY: 0,
        cropWidth: 1,
        cropHeight: 1,
        isDefault: true,
      })),
      skipDuplicates: true,
    });
  }

  const templates = await prisma.clipCropTemplate.findMany({
    where: { userId: user.id },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });

  return NextResponse.json(templates);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email: session.user.email },
    select: { id: true },
  });
  if (!user) {
    return NextResponse.json({ error: 'User not found' }, { status: 404 });
  }

  const body = await req.json();
  const name = String(body?.name || '').trim();
  const aspectRatio = String(body?.aspectRatio || '');
  const cropX = Number(body?.cropX);
  const cropY = Number(body?.cropY);
  const cropWidth = Number(body?.cropWidth);
  const cropHeight = Number(body?.cropHeight);

  if (!name) {
    return NextResponse.json({ error: 'Template name is required.' }, { status: 400 });
  }
  if (!isValidAspect(aspectRatio)) {
    return NextResponse.json({ error: 'Invalid aspect ratio.' }, { status: 400 });
  }

  const values = [cropX, cropY, cropWidth, cropHeight];
  if (values.some((value) => Number.isNaN(value))) {
    return NextResponse.json({ error: 'Invalid crop values.' }, { status: 400 });
  }
  if (cropWidth <= 0 || cropHeight <= 0 || cropWidth > 1 || cropHeight > 1) {
    return NextResponse.json({ error: 'Crop size must be between 0 and 1.' }, { status: 400 });
  }
  if (cropX < 0 || cropY < 0 || cropX + cropWidth > 1 || cropY + cropHeight > 1) {
    return NextResponse.json({ error: 'Crop bounds must be within 0 to 1.' }, { status: 400 });
  }

  const existing = await prisma.clipCropTemplate.findFirst({
    where: { userId: user.id, name },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ error: 'Template name already exists.' }, { status: 409 });
  }

  const template = await prisma.clipCropTemplate.create({
    data: {
      userId: user.id,
      name,
      aspectRatio,
      cropX,
      cropY,
      cropWidth,
      cropHeight,
      isDefault: false,
    },
  });

  return NextResponse.json(template);
}
