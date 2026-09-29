import type { LLMChatMessage, LLMChatOptions, LLMChatProvider, LLMChatResponse } from './types';
import { LLMTransientError } from './types';

/**
 * Gemini adapter for the unified LLM chat contract.
 *
 * Gemini's REST API is NOT OpenAI-compat by default (they wrap it under
 * `/openai/*` but the primary path is `/v1beta/models/*:generateContent`
 * with a different message shape). Since the codebase already speaks the
 * native shape (see `truth-analysis.ts`, `truth-chat.ts`), this adapter
 * targets the native `/generateContent` endpoint too — no format
 * translation drift between the fallback path and the primary Gemini
 * scoring paths.
 *
 * Model default: `gemini-2.5-flash-lite` — the cheapest 2.5-family model
 * ($0.10/M in, $0.40/M out per ai.google.dev/pricing 2026-09-29), which
 * is a strict cost improvement over 2.0-flash for the text-only tasks
 * the fallback chain handles (metadata / captions / truth text).
 */
export class GeminiChatAdapter implements LLMChatProvider {
  readonly name = 'gemini';

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY);
  }

  async chat(messages: LLMChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResponse> {
    const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new LLMTransientError('gemini', 'Missing GOOGLE_API_KEY / GEMINI_API_KEY', 401);
    }

    const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';

    // Extract the leading system message (if any); Gemini uses a separate
    // `systemInstruction` field.
    let systemInstruction: string | undefined;
    const conversational = messages.filter((m) => {
      if (m.role === 'system' && systemInstruction === undefined) {
        systemInstruction = m.content;
        return false;
      }
      return true;
    });

    const contents = conversational.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        temperature: options.temperature ?? 0.2,
        maxOutputTokens: options.maxOutputTokens ?? 1024,
        ...(options.jsonMode ? { responseMimeType: 'application/json' } : {}),
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { role: 'system', parts: [{ text: systemInstruction }] };
    }

    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMTransientError('gemini', `network: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const status = res.status;
      const transient = status === 429 || status >= 500;
      throw transient
        ? new LLMTransientError('gemini', `HTTP ${status}: ${text.slice(0, 200)}`, status)
        : new Error(`[gemini] HTTP ${status}: ${text.slice(0, 200)}`);
    }

    const data: any = await res.json();
    const durationMs = Date.now() - startedAt;
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    const usage = data?.usageMetadata ?? {};
    const inputTokens: number | undefined = usage.promptTokenCount;
    const outputTokens: number | undefined = usage.candidatesTokenCount;

    // gemini-2.5-flash-lite pricing (2026-09-29): $0.10/M in, $0.40/M out.
    // gemini-2.5-flash pricing: $0.30/M in, $2.50/M out.
    const isLite = model.includes('lite');
    const inRate = isLite ? 0.1 : 0.3;
    const outRate = isLite ? 0.4 : 2.5;
    const estimatedCostUsd =
      inputTokens && outputTokens
        ? (inputTokens / 1_000_000) * inRate + (outputTokens / 1_000_000) * outRate
        : 0;

    return {
      provider: 'gemini',
      model,
      text,
      usage: { inputTokens, outputTokens, estimatedCostUsd },
      durationMs,
    };
  }
}
