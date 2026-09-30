import type { LLMChatMessage, LLMChatOptions, LLMChatProvider, LLMChatResponse } from './types';
import { LLMTransientError } from './types';

/**
 * Ollama adapter for the unified LLM chat contract.
 *
 * Kept as a first-class provider even after we retire the Fargate
 * self-host — dev/laptop workflows still hit local Ollama, and the
 * distillation roadmap (see `CLAUDE.md` — "AI cost strategy") ends
 * with a fine-tuned model served via Ollama. This adapter is the ONE
 * place the rest of the codebase talks to Ollama going forward; the
 * legacy call sites (`ollama-scoring.ts`, `truth-chat.ts`,
 * `metadata-generation.ts`, `generate-description`, `publish/generate-meta`)
 * are replaced with `getLLM().chat(...)` calls in a follow-up commit.
 */
export class OllamaChatAdapter implements LLMChatProvider {
  readonly name = 'ollama';

  async isAvailable(): Promise<boolean> {
    // Ollama has no API key — availability = reachable base URL.
    const baseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
    if (!baseUrl) return false;
    try {
      const res = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async chat(messages: LLMChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResponse> {
    const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/$/, '');
    const model = process.env.OLLAMA_MODEL || 'llama3';

    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 120_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages,
      stream: false,
      options: {
        temperature: options.temperature ?? 0.2,
        num_predict: options.maxOutputTokens ?? 1024,
      },
      ...(options.jsonMode ? { format: 'json' } : {}),
    };

    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMTransientError('ollama', `network: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const status = res.status;
      const transient = status === 429 || status >= 500;
      throw transient
        ? new LLMTransientError('ollama', `HTTP ${status}: ${text.slice(0, 200)}`, status)
        : new Error(`[ollama] HTTP ${status}: ${text.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const durationMs = Date.now() - startedAt;
    const text: string = data?.message?.content ?? '';

    return {
      provider: 'ollama',
      model,
      text,
      usage: {
        inputTokens: data?.prompt_eval_count,
        outputTokens: data?.eval_count,
        estimatedCostUsd: 0, // local inference
      },
      durationMs,
    };
  }
}
