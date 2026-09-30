import type { LLMChatMessage, LLMChatOptions, LLMChatProvider, LLMChatResponse } from './types';
import { LLMTransientError } from './types';
import { OpenAICompatAdapter, OPENAI_COMPAT_PROVIDERS } from './openai-compat-adapter';
import { GeminiChatAdapter } from './gemini-adapter';
import { OllamaChatAdapter } from './ollama-adapter';

/**
 * Unified LLM provider entry point.
 *
 * Env-driven fallback chain — a comma-separated list of provider names in
 * `LLM_PROVIDER_CHAIN`. Each name resolves to an adapter above. First one
 * that (a) is available at boot AND (b) doesn't throw an `LLMTransientError`
 * at call time serves the request. Non-transient errors (bad prompt, 4xx
 * auth) bubble up immediately — we don't want to burn the entire chain on
 * a permanent bug.
 *
 * Default chain (see `docs/migration/llm-strategy.md` for rationale):
 *   groq → gemini → deepinfra
 *
 * - `groq` is the cheapest + fastest option that also has a free tier
 *   generous enough to cover pre-launch load. Winner.
 * - `gemini` is the fallback because it's ALREADY integrated (Google's
 *   free tier plus our existing GOOGLE_API_KEY) so falling back to it
 *   requires zero new credentials.
 * - `deepinfra` is the tertiary because it has the cheapest paid Llama
 *   3.3 70B ($0.10 in / $0.32 out per M), broad model catalog, and no
 *   overlap in outage domain with the other two.
 *
 * `ollama` stays available for local dev + as the eventual Phase 4
 *  fine-tuned-model target — set `LLM_PROVIDER_CHAIN=ollama` (or prepend
 *  it) in dev environments where Ollama is running on the host.
 */

const PROVIDER_CACHE: Record<string, LLMChatProvider> = {};

function buildProvider(name: string): LLMChatProvider | null {
  if (PROVIDER_CACHE[name]) return PROVIDER_CACHE[name];

  if (name === 'gemini') {
    return (PROVIDER_CACHE[name] = new GeminiChatAdapter());
  }
  if (name === 'ollama') {
    return (PROVIDER_CACHE[name] = new OllamaChatAdapter());
  }
  const openaiCompat = OPENAI_COMPAT_PROVIDERS[name];
  if (openaiCompat) {
    return (PROVIDER_CACHE[name] = new OpenAICompatAdapter(openaiCompat));
  }
  console.warn(`[llm] unknown provider name in chain: ${name}`);
  return null;
}

function parseChain(): string[] {
  const raw = (process.env.LLM_PROVIDER_CHAIN || 'groq,gemini,deepinfra').trim();
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Fire the chat call through the fallback chain. Returns the first
 * successful response; throws if every provider errors.
 */
export async function chat(
  messages: LLMChatMessage[],
  options: LLMChatOptions = {}
): Promise<LLMChatResponse> {
  const chain = parseChain();
  if (chain.length === 0) {
    throw new Error('LLM_PROVIDER_CHAIN is empty — refusing to fire a chat call');
  }

  const errors: string[] = [];
  for (const name of chain) {
    const provider = buildProvider(name);
    if (!provider) continue;
    // Cheap creds check — skip providers that we KNOW can't work (no
    // API key set). Ollama's isAvailable() actually pings; the others
    // just check env. Cost = negligible.
    if (!(await provider.isAvailable())) {
      errors.push(`${name}: unavailable (no creds / unreachable)`);
      continue;
    }
    try {
      const response = await provider.chat(messages, options);
      if (errors.length) {
        console.log(
          `[llm] ${name} succeeded after ${errors.length} prior failure(s): ${errors.join(' | ')}`
        );
      }
      return response;
    } catch (err) {
      if (err instanceof LLMTransientError) {
        errors.push(`${name}: transient ${err.status ?? ''} — ${err.message}`);
        continue;
      }
      // Hard error — stop the chain and surface the real problem.
      throw err;
    }
  }

  throw new Error(
    `[llm] all providers in chain (${chain.join(' → ')}) failed: ${errors.join(' | ')}`
  );
}

/**
 * Return the first available provider without firing a call — useful for
 * boot-time diagnostics + admin dashboards.
 */
export async function resolveActiveProvider(): Promise<LLMChatProvider | null> {
  for (const name of parseChain()) {
    const p = buildProvider(name);
    if (p && (await p.isAvailable())) return p;
  }
  return null;
}

/**
 * Introspection helper — list which providers in the chain are currently
 * reachable. Used by the (future) `/api/admin/llm-status` route.
 */
export async function chainStatus(): Promise<
  Array<{ name: string; available: boolean; reason?: string }>
> {
  const results: Array<{ name: string; available: boolean; reason?: string }> = [];
  for (const name of parseChain()) {
    const p = buildProvider(name);
    if (!p) {
      results.push({ name, available: false, reason: 'unknown provider name' });
      continue;
    }
    const available = await p.isAvailable();
    results.push({
      name,
      available,
      reason: available ? undefined : 'no creds or unreachable',
    });
  }
  return results;
}

export type { LLMChatMessage, LLMChatOptions, LLMChatProvider, LLMChatResponse } from './types';
