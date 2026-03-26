import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import type { LLMProvider } from '@shared/virality';
import { checkLlmProviderAccess } from '@/lib/plans';

function normalizeProvider(value?: string | null): LLMProvider {
  return value && value.toLowerCase() === 'ollama' ? 'ollama' : 'gemini';
}

export async function GET(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const fallback = normalizeProvider(process.env.LLM_PROVIDER);
  return NextResponse.json({
    llmProvider: normalizeProvider(user.defaultLLMProvider ?? fallback),
  });
}

async function handleUpdate(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
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

  const providerAccess = checkLlmProviderAccess(provider, user.subscriptionPlan);
  if (!providerAccess.allowed) {
    return NextResponse.json(
      {
        error: providerAccess.message,
        code: 'PLAN_RESTRICTED',
        allowedProviders: providerAccess.allowedProviders,
      },
      { status: 403 }
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { defaultLLMProvider: provider },
  });

  return NextResponse.json({ llmProvider: provider });
}

export const PUT = handleUpdate;
export const PATCH = handleUpdate;
