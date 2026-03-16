import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { PublishService } from '@shared/lib/publishing/publish-service';

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const service = new PublishService();
    const result = await service.verifySubstack(id, user.id);

    return NextResponse.json(result);
  } catch (err) {
    console.error('[GET /api/publications/:id/substack/verify] Error:', err);
    return NextResponse.json({ error: 'Failed to verify connection' }, { status: 500 });
  }
}
