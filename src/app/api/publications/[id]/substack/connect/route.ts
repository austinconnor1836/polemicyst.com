import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { PublishService } from '@shared/lib/publishing/publish-service';
import { ConnectSubstackSchema } from '@shared/lib/publishing/validation';
import { SubstackError } from '@shared/lib/publishing/errors';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const parsed = ConnectSubstackSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
    }

    const service = new PublishService();
    const result = await service.connectSubstack(
      id,
      user.id,
      parsed.data.cookie,
      parsed.data.subdomain
    );

    return NextResponse.json({
      success: true,
      publicationName: result.publicationName,
    });
  } catch (err) {
    if (err instanceof SubstackError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode || 400 }
      );
    }
    console.error('[POST /api/publications/:id/substack/connect] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to connect Substack' },
      { status: 500 }
    );
  }
}
