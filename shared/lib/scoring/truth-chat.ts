import type { LLMCostMeta } from './llm-types';
import { estimateGeminiCost } from '../cost-tracking';
import type { TruthAnalysisResult } from './truth-analysis';

// ── Types ──────────────────────────────────────────────────────────────

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};

export type ChatParams = {
  transcript: string;
  analysisResult: TruthAnalysisResult;
  messages: ChatMessage[];
  provider: 'gemini' | 'ollama';
};

export type ChatResponse = {
  content: string;
  _cost: LLMCostMeta;
};

// ── System prompt ──────────────────────────────────────────────────────

function buildSystemPrompt(transcript: string, analysisResult: TruthAnalysisResult): string {
  const maxTranscriptChars = 15000;
  const truncated = transcript.length > maxTranscriptChars;
  const trimmedTranscript = truncated
    ? transcript.slice(0, maxTranscriptChars) + '\n... (transcript truncated)'
    : transcript;

  // Build a concise summary of the analysis
  const analysisSummary = [
    `Summary: ${analysisResult.summary}`,
    `Credibility: ${analysisResult.overallCredibility}/10`,
    `Bias level: ${analysisResult.overallBiasLevel}`,
    `Assertions: ${analysisResult.assertions.length}`,
    `Fallacies: ${analysisResult.fallacies.length}`,
    `Biases: ${analysisResult.biases.length}`,
    analysisResult.fallacies.length > 0
      ? `Key fallacies: ${analysisResult.fallacies.map((f) => f.name).join(', ')}`
      : null,
    analysisResult.biases.length > 0
      ? `Key biases: ${analysisResult.biases.map((b) => b.type).join(', ')}`
      : null,
    analysisResult.recommendedFactChecks.length > 0
      ? `Recommended fact checks: ${analysisResult.recommendedFactChecks.join('; ')}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

  return [
    `You are an AI media analyst. You previously analyzed a video transcript and produced the following analysis:`,
    ``,
    analysisSummary,
    ``,
    `The original transcript:`,
    `"""`,
    trimmedTranscript,
    `"""`,
    ``,
    `The user wants to discuss this analysis with you. Answer questions about the assertions, fallacies, biases, and fact-checking needs you identified. Be thorough but concise. If the user asks about something outside the analysis, you can reference the original transcript. Use markdown formatting when appropriate.`,
  ].join('\n');
}

// ── Gemini ──────────────────────────────────────────────────────────────

export async function chatWithGemini(params: ChatParams): Promise<ChatResponse> {
  const { transcript, analysisResult, messages } = params;

  const apiKey: string = process.env.GOOGLE_API_KEY ?? '';
  if (!apiKey) throw new Error('GOOGLE_API_KEY is not configured');

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';
  const modelName = process.env.GEMINI_MODEL;

  async function pickDefaultModel(): Promise<string> {
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`ListModels failed (${res.status}): ${JSON.stringify(json)}`);
    const models = (json.models || []) as Array<{
      name: string;
      supportedGenerationMethods?: string[];
    }>;
    const supported = models.filter((m: any) =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );
    const flash = supported.find((m: any) => /gemini/i.test(m.name) && /flash/i.test(m.name));
    if (flash) return flash.name;
    const pro = supported.find((m: any) => /gemini/i.test(m.name) && /pro/i.test(m.name));
    if (pro) return pro.name;
    if (supported[0]) return supported[0].name;
    throw new Error('No models available that support generateContent');
  }

  let chosenModel = modelName || (await pickDefaultModel());
  if (!chosenModel.startsWith('models/')) chosenModel = `models/${chosenModel}`;

  const systemPrompt = buildSystemPrompt(transcript, analysisResult);

  // Build Gemini multi-turn contents array
  // System instruction goes as first user message, then alternate user/model
  const contents: Array<{ role: string; parts: Array<{ text: string }> }> = [];

  // Gemini uses systemInstruction for system prompts
  const geminiMessages = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  contents.push(...geminiMessages);

  const body = {
    systemInstruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: { temperature: 0.4 },
  };

  const startedAt = Date.now();
  console.log(`[truth-chat] Calling Gemini API (${chosenModel})...`);

  const res = await fetch(
    `${baseUrl}/${chosenModel}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }
  );

  const responseText = await res.text();
  let json;
  try {
    json = JSON.parse(responseText);
  } catch {
    throw new Error(`Gemini API returned ${res.status} (Non-JSON): ${responseText}`);
  }

  if (!res.ok) {
    throw new Error(`Gemini generateContent failed (${res.status}): ${JSON.stringify(json)}`);
  }

  const usageMetadata = json?.usageMetadata;
  const actualInputTokens = usageMetadata?.promptTokenCount as number | undefined;
  const actualOutputTokens = usageMetadata?.candidatesTokenCount as number | undefined;

  const text =
    json?.candidates?.[0]?.content?.parts
      ?.map((p: any) => p.text)
      .filter(Boolean)
      .join('') ?? '';

  if (!text) {
    throw new Error('Gemini returned empty response');
  }

  const durationMs = Date.now() - startedAt;

  // Estimate total input chars for cost calculation
  const totalInputChars =
    systemPrompt.length + messages.reduce((sum, m) => sum + m.content.length, 0);
  const costEstimate = estimateGeminiCost({
    transcriptChars: totalInputChars,
    outputTokens: actualOutputTokens,
  });

  const costMeta: LLMCostMeta = {
    inputTokens: actualInputTokens ?? costEstimate.inputTokens,
    outputTokens: actualOutputTokens ?? costEstimate.outputTokens,
    estimatedCostUsd: actualInputTokens
      ? (actualInputTokens / 1_000_000) * 0.075 + ((actualOutputTokens ?? 200) / 1_000_000) * 0.3
      : costEstimate.estimatedCostUsd,
    modelName: chosenModel,
    durationMs,
  };

  console.log(`[truth-chat] Gemini done in ${durationMs}ms`);

  return { content: text, _cost: costMeta };
}

// ── Ollama ──────────────────────────────────────────────────────────────

export async function chatWithOllama(params: ChatParams): Promise<ChatResponse> {
  const { transcript, analysisResult, messages } = params;

  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const localDefault = 'http://127.0.0.1:11434';
  const dockerServiceDefault = 'http://ollama:11434';
  let baseUrl = configuredBaseUrl || localDefault;
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const systemPrompt = buildSystemPrompt(transcript, analysisResult);

  // Build Ollama /api/chat message array
  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const startedAt = Date.now();
  console.log(`[truth-chat] Calling Ollama (${model})...`);

  let res;
  try {
    res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: ollamaMessages,
        stream: false,
        options: { temperature: 0.4 },
      }),
    });
  } catch (err) {
    if (!configuredBaseUrl && baseUrl !== dockerServiceDefault) {
      baseUrl = dockerServiceDefault;
      res = await fetch(`${baseUrl}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          messages: ollamaMessages,
          stream: false,
          options: { temperature: 0.4 },
        }),
      });
    } else {
      throw err;
    }
  }

  const data = await res.json();
  if (!res.ok) {
    throw new Error(`Ollama error (${res.status}): ${JSON.stringify(data)}`);
  }

  const text = (data?.message?.content ?? '').toString().trim();
  if (!text) {
    throw new Error('Ollama returned empty response');
  }

  const durationMs = Date.now() - startedAt;
  const ollamaInputTokens = data?.prompt_eval_count as number | undefined;
  const ollamaOutputTokens = data?.eval_count as number | undefined;

  const costMeta: LLMCostMeta = {
    inputTokens: ollamaInputTokens,
    outputTokens: ollamaOutputTokens,
    estimatedCostUsd: 0,
    modelName: model,
    durationMs,
  };

  console.log(`[truth-chat] Ollama done in ${durationMs}ms`);

  return { content: text, _cost: costMeta };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

export async function chatAboutAnalysis(params: ChatParams): Promise<ChatResponse> {
  if (params.provider === 'ollama') {
    return chatWithOllama(params);
  }
  return chatWithGemini(params);
}
