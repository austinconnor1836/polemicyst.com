import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { PublishService } from '@shared/lib/publishing/publish-service';
import { ConnectPublishingAccountSchema } from '@shared/lib/publishing/validation';
import { SubstackError } from '@shared/lib/publishing/errors';

export async function GET(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const accounts = await prisma.publishingAccount.findMany({
      where: { userId: user.id },
      select: {
        id: true,
        platform: true,
        displayName: true,
        platformUrl: true,
        connected: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json(accounts);
  } catch (err) {
    console.error('[GET /api/publishing-accounts] Error:', err);
    return NextResponse.json({ error: 'Failed to load publishing accounts' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await req.json();
    const parsed = ConnectPublishingAccountSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const { platform, cookie, subdomain } = parsed.data;

    const service = new PublishService();
    const account = await service.connectAccount(user.id, platform, { cookie, subdomain });

    return NextResponse.json({
      id: account.id,
      platform: account.platform,
      displayName: account.displayName,
      platformUrl: account.platformUrl,
      connected: account.connected,
    });
  } catch (err) {
    if (err instanceof SubstackError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode || 500 }
      );
    }
    console.error('[POST /api/publishing-accounts] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to connect account' },
      { status: 500 }
    );
  }
}
