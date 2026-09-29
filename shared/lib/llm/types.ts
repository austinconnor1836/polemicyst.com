/**
 * Unified LLM chat contract used by the fallback chain.
 *
 * This is the SAME shape Ollama exposes today (see `/api/chat` + `/api/generate`
 * in `shared/lib/scoring/ollama-scoring.ts` and `truth-chat.ts`) — a JSON-in /
 * JSON-out text completion. Every adapter under this dir speaks this contract
 * so callers can swap providers via a single env var.
 *
 * NOTE: this is intentionally the "plain text prompt" contract, not a rich
 * multimodal one — Ollama's role in the pipeline was ALWAYS text-only
 * (metadata / captions / truth / non-multimodal scoring). Gemini still owns
 * the multimodal-scoring path (frames + audio); we don't replace that here.
 */

export interface LLMChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LLMChatOptions {
  /**
   * Provider-agnostic sampling temperature (0..1 typically).
   */
  temperature?: number;
  /**
   * Cap on generated tokens. Providers map this to their own field name
   * (max_tokens for OpenAI-compat, num_predict for Ollama).
   */
  maxOutputTokens?: number;
  /**
   * When set, providers that support JSON-mode will hint the model to
   * return valid JSON. Callers still must parse + repair defensively.
   */
  jsonMode?: boolean;
  /**
   * Overall wall-clock cap in ms. Providers should honor this via AbortSignal.
   */
  timeoutMs?: number;
}

export interface LLMChatUsage {
  inputTokens?: number;
  outputTokens?: number;
  /**
   * USD cost estimate for this SINGLE call.
   * 0 means "we don't bill for this" (self-hosted Ollama or free tier).
   */
  estimatedCostUsd: number;
}

export interface LLMChatResponse {
  /** Provider identifier that actually served this call (may differ from
   * requested provider if the fallback chain kicked in). */
  provider: string;
  /** Model identifier that served the call. */
  model: string;
  /** The generated text — same shape as Ollama's `data.response` /
   * `data.message.content`. Callers parse JSON out of this themselves. */
  text: string;
  usage: LLMChatUsage;
  durationMs: number;
}

export interface LLMChatProvider {
  /** Stable identifier (`groq`, `gemini`, `deepinfra`, `ollama`, ...). */
  readonly name: string;
  /** Chat completion — the ONE call this whole layer supports. */
  chat(messages: LLMChatMessage[], options?: LLMChatOptions): Promise<LLMChatResponse>;
  /**
   * Cheap health probe. Returns `true` if the provider looks reachable AND
   * has credentials configured. Used at boot to prune the fallback chain.
   */
  isAvailable(): Promise<boolean>;
}

/**
 * Errors that should trigger the fallback chain to advance to the next
 * provider. Non-retryable errors (4xx auth, 400 bad request) should be
 * thrown as plain Error so the caller sees the real problem.
 */
export class LLMTransientError extends Error {
  readonly provider: string;
  readonly status?: number;
  constructor(provider: string, message: string, status?: number) {
    super(`[${provider}] ${message}`);
    this.provider = provider;
    this.status = status;
    this.name = 'LLMTransientError';
  }
}
