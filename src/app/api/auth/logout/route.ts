import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ message: 'Not authenticated' }, { status: 401 });
  }

  const { provider } = await req.json();
  if (!provider) {
    return NextResponse.json({ message: 'Provider is required' }, { status: 400 });
  }

  try {
    await prisma.account.deleteMany({
      where: {
        userId: user.id,
        provider: provider === 'facebook' ? { in: ['facebook', 'instagram'] } : provider,
      },
    });

    const remainingProviders = await prisma.account.findMany({
      where: { userId: user.id },
      select: { provider: true },
    });

    return NextResponse.json({
      message: `Logged out from ${provider}`,
      remainingProviders: remainingProviders.map((acc: any) => acc.provider),
    });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json({ message: 'Logout failed' }, { status: 500 });
  }
}
