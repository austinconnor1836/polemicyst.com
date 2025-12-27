import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '../../../../../auth';
import { prisma } from '@shared/lib/prisma';
import type { LLMProvider } from '@shared/virality';

function normalizeProvider(value?: string | null): LLMProvider {
  return value && value.toLowerCase() === 'ollama' ? 'ollama' : 'gemini';
}

async function requireUserEmail() {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return null;
  }
  return session.user.email;
}

export async function GET() {
  const email = await requireUserEmail();
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const user = await prisma.user.findUnique({
    where: { email },
    select: { defaultLLMProvider: true },
  });

  const fallback = normalizeProvider(process.env.LLM_PROVIDER);
  return NextResponse.json({
    llmProvider: normalizeProvider(user?.defaultLLMProvider ?? fallback),
  });
}

async function handleUpdate(req: NextRequest) {
  const email = await requireUserEmail();
  if (!email) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: any;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const requested = typeof body?.llmProvider === 'string' ? body.llmProvider.toLowerCase() : '';
  const provider =
    requested === 'ollama' || requested === 'gemini' ? (requested as LLMProvider) : null;
  if (!provider) {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  await prisma.user.update({
    where: { email },
    data: { defaultLLMProvider: provider },
  });

  return NextResponse.json({ llmProvider: provider });
}

export const PUT = handleUpdate;
export const PATCH = handleUpdate;
