import { NextResponse } from 'next/server';
import { getJobProgress } from '@shared/lib/job-progress';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const progress = await getJobProgress(id);
  if (!progress) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  return NextResponse.json(progress);
}
