/**
 * Unified LLM entry point.
 *
 * Callers should import from `@shared/lib/llm` and use `chat()` for every
 * text-only LLM call that USED to hit Ollama (metadata generation, viral
 * scoring for the text-only path, truth analysis, truth chat, caption /
 * description generation, quote detection). Multimodal Gemini calls
 * (frames + audio) stay on the existing `gemini-scoring.ts` path — the
 * unified adapter is intentionally text-only.
 *
 * See `docs/migration/llm-strategy.md` for the full migration plan +
 * fallback ordering + env var reference.
 */

export { chat, resolveActiveProvider, chainStatus } from './llm-provider';
export type {
  LLMChatMessage,
  LLMChatOptions,
  LLMChatProvider,
  LLMChatResponse,
  LLMChatUsage,
} from './types';
export { LLMTransientError } from './types';
