import type { LLMChatMessage, LLMChatOptions, LLMChatProvider, LLMChatResponse } from './types';
import { LLMTransientError } from './types';

/**
 * OpenAI-compatible `/v1/chat/completions` adapter.
 *
 * ONE adapter, N providers — Groq, Together, Fireworks, DeepInfra, and
 * OpenRouter all expose the exact same wire format as OpenAI, differing
 * only in base URL + auth header + model catalog + price/token. Rather
 * than write five near-identical adapters we parameterize the adapter
 * and let a thin registry map each provider name to its config.
 *
 * We do NOT depend on the `openai` npm package here — this codebase already
 * uses native `fetch` everywhere (see `ollama-scoring.ts`, `truth-chat.ts`),
 * so keeping the adapter dependency-free means the migration adds 0 new
 * npm deps.
 */
export interface OpenAICompatConfig {
  /** Stable identifier used in logs, cost rows, and fallback config. */
  name: string;
  /** Env var name holding the API key. */
  apiKeyEnv: string;
  /** Full base URL, e.g. `https://api.groq.com/openai/v1`. */
  baseUrl: string;
  /** Default model to use if the caller doesn't override. */
  defaultModel: string;
  /**
   * Per-1M-token pricing for the DEFAULT model. Callers passing a different
   * model can supply price overrides via env; keeps the adapter simple.
   */
  pricing: {
    inputPerMillion: number;
    outputPerMillion: number;
  };
  /**
   * Extra headers to send with every request. Used for OpenRouter's
   * `HTTP-Referer` + `X-Title` attribution headers.
   */
  extraHeaders?: Record<string, string>;
}

export class OpenAICompatAdapter implements LLMChatProvider {
  readonly name: string;
  private readonly config: OpenAICompatConfig;

  constructor(config: OpenAICompatConfig) {
    this.name = config.name;
    this.config = config;
  }

  async isAvailable(): Promise<boolean> {
    return Boolean(process.env[this.config.apiKeyEnv]);
  }

  async chat(messages: LLMChatMessage[], options: LLMChatOptions = {}): Promise<LLMChatResponse> {
    const apiKey = process.env[this.config.apiKeyEnv];
    if (!apiKey) {
      throw new LLMTransientError(this.name, `Missing ${this.config.apiKeyEnv}`, 401);
    }

    const model = process.env[`${this.name.toUpperCase()}_MODEL`] || this.config.defaultModel;
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 60_000;
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    const body: Record<string, unknown> = {
      model,
      messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxOutputTokens ?? 1024,
      stream: false,
    };
    if (options.jsonMode) {
      // OpenAI-compat providers accept this; the ones that don't (some
      // Together / older Fireworks endpoints) silently ignore it.
      body.response_format = { type: 'json_object' };
    }

    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...(this.config.extraHeaders ?? {}),
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      // Network / abort / DNS — treat as transient so fallback advances.
      const msg = err instanceof Error ? err.message : String(err);
      throw new LLMTransientError(this.name, `network: ${msg}`);
    } finally {
      clearTimeout(timeout);
    }

    // 5xx + 429 → transient (fall through to next provider).
    // 4xx (other) → hard error (bad prompt, kill the request).
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const status = res.status;
      const transient = status === 429 || status >= 500;
      const err = transient
        ? new LLMTransientError(this.name, `HTTP ${status}: ${text.slice(0, 200)}`, status)
        : new Error(`[${this.name}] HTTP ${status}: ${text.slice(0, 200)}`);
      throw err;
    }

    const data: any = await res.json();
    const durationMs = Date.now() - startedAt;
    const text: string = data?.choices?.[0]?.message?.content ?? '';
    const usage = data?.usage ?? {};
    const inputTokens: number | undefined = usage.prompt_tokens;
    const outputTokens: number | undefined = usage.completion_tokens;

    const estimatedCostUsd =
      inputTokens && outputTokens
        ? (inputTokens / 1_000_000) * this.config.pricing.inputPerMillion +
          (outputTokens / 1_000_000) * this.config.pricing.outputPerMillion
        : 0;

    return {
      provider: this.name,
      model,
      text,
      usage: { inputTokens, outputTokens, estimatedCostUsd },
      durationMs,
    };
  }
}

/**
 * Provider registry. Prices as of 2026-09-29 — see
 * `docs/migration/llm-strategy.md` for source citations. Numbers here are
 * used ONLY for cost estimation logging; billing accuracy comes from
 * each provider's actual `usage` field.
 */
export const OPENAI_COMPAT_PROVIDERS: Record<string, OpenAICompatConfig> = {
  groq: {
    name: 'groq',
    apiKeyEnv: 'GROQ_API_KEY',
    baseUrl: 'https://api.groq.com/openai/v1',
    // Groq's fastest small model. Free tier is generous; paid tier is
    // Enterprise-only for Llama 70B, so the public "cheap + fast" model
    // is llama-3.1-8b-instant + openai/gpt-oss-120b.
    defaultModel: 'llama-3.1-8b-instant',
    pricing: {
      // Groq's public blended price for Llama 3.1 8B is $0.05/M tokens
      // (per groq.com/pricing 2026-09-29). We apply it symmetrically.
      inputPerMillion: 0.05,
      outputPerMillion: 0.08,
    },
  },
  deepinfra: {
    name: 'deepinfra',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    baseUrl: 'https://api.deepinfra.com/v1/openai',
    // Llama 3.3 70B Instruct Turbo — the price/quality sweet spot on
    // DeepInfra ($0.10 in / $0.32 out per M).
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    pricing: { inputPerMillion: 0.1, outputPerMillion: 0.32 },
  },
  together: {
    name: 'together',
    apiKeyEnv: 'TOGETHER_API_KEY',
    baseUrl: 'https://api.together.xyz/v1',
    defaultModel: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    pricing: { inputPerMillion: 1.04, outputPerMillion: 1.04 },
  },
  fireworks: {
    name: 'fireworks',
    apiKeyEnv: 'FIREWORKS_API_KEY',
    baseUrl: 'https://api.fireworks.ai/inference/v1',
    defaultModel: 'accounts/fireworks/models/llama-v3p3-70b-instruct',
    // Fireworks lists $0.90/M blended for Llama 3.3 70B. Symmetric.
    pricing: { inputPerMillion: 0.9, outputPerMillion: 0.9 },
  },
  openrouter: {
    name: 'openrouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'meta-llama/llama-3.3-70b-instruct',
    // OpenRouter is a broker — actual price depends on which upstream it
    // routes to. Conservative estimate matches DeepInfra pricing since
    // OpenRouter often ends up there for Llama 3.3 70B.
    pricing: { inputPerMillion: 0.13, outputPerMillion: 0.4 },
    extraHeaders: {
      // OpenRouter recommends these for attribution + rate-limit priority.
      'HTTP-Referer': process.env.OPENROUTER_SITE_URL || 'https://clipfire.ai',
      'X-Title': 'Clipfire',
    },
  },
};
