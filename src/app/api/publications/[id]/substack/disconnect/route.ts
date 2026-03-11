import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { PublishService } from '@shared/lib/publishing/publish-service';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const service = new PublishService();
    await service.disconnectSubstack(id, user.id);

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error('[POST /api/publications/:id/substack/disconnect] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to disconnect' },
      { status: 500 }
    );
  }
}
