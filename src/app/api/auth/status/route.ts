import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ isAuthenticated: {} }, { status: 401 });
  }

  try {
    const accounts = await prisma.account.findMany({
      where: { userId: user.id },
      select: { provider: true },
    });

    // Convert accounts array into an object like { bluesky: true, google: true, ... }
    const isAuthenticated = accounts.reduce(
      (acc, { provider }) => {
        acc[provider] = true;
        return acc;
      },
      {} as Record<string, boolean>
    );

    return NextResponse.json({ isAuthenticated });
  } catch (error) {
    console.error('Error fetching authentication status:', error);
    return NextResponse.json({ isAuthenticated: {} }, { status: 500 });
  }
}
