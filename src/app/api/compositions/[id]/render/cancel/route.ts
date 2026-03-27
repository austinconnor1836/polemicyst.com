import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getReactionComposeQueue } from '@shared/queues';

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const composition = await prisma.composition.findFirst({
      where: { id, userId: user.id },
      include: { outputs: true },
    });
    if (!composition) {
      return NextResponse.json({ error: 'Composition not found' }, { status: 404 });
    }

    if (composition.status !== 'rendering') {
      return NextResponse.json({ error: 'No render in progress' }, { status: 409 });
    }

    // Try to remove the BullMQ job
    const queue = getReactionComposeQueue();
    const job = await queue.getJob(id);
    if (job) {
      try {
        await job.remove();
      } catch (err: any) {
        console.warn(`[cancel-render] Could not remove job ${id}: ${err.message}`);
      }
    }

    // Reset composition status and output statuses
    await prisma.composition.update({
      where: { id },
      data: { status: 'draft' },
    });

    for (const output of composition.outputs) {
      if (output.status === 'rendering' || output.status === 'pending') {
        await prisma.compositionOutput.update({
          where: { id: output.id },
          data: { status: 'failed', renderError: 'Cancelled by user' },
        });
      }
    }

    return NextResponse.json({ status: 'cancelled' });
  } catch (err) {
    console.error('[POST /api/compositions/[id]/render/cancel]', err);
    return NextResponse.json({ error: 'Failed to cancel render' }, { status: 500 });
  }
}
