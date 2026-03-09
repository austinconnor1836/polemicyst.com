import type { LLMCostMeta } from './llm-types';
import { estimateGeminiCost } from '../cost-tracking';

// ── Types ──────────────────────────────────────────────────────────────

export type TruthAnalysisAssertion = {
  id: number;
  text: string;
  category: 'claim' | 'assumption' | 'opinion' | 'factual';
  confidence: number;
  factCheckNeeded: boolean;
  factCheckReason?: string;
};

export type TruthAnalysisFallacy = {
  id: number;
  name: string;
  description: string;
  assertionIds: number[];
  severity: 'minor' | 'moderate' | 'major';
  confidence: number;
};

export type TruthAnalysisBias = {
  id: number;
  type: string;
  description: string;
  direction?: string;
  evidence: string;
  confidence: number;
};

export type TruthAnalysisResult = {
  summary: string;
  assertions: TruthAnalysisAssertion[];
  fallacies: TruthAnalysisFallacy[];
  biases: TruthAnalysisBias[];
  overallCredibility: number;
  overallBiasLevel: 'low' | 'moderate' | 'high';
  keyAssumptions: string[];
  recommendedFactChecks: string[];
  _cost?: LLMCostMeta;
};

// ── Helpers ────────────────────────────────────────────────────────────

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function stripCodeFences(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced && fenced[1]) return fenced[1];
  return text;
}

function tryParseJsonLoose(text: string): any | null {
  const cleaned = stripCodeFences(text);
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;

  const fragment = cleaned.slice(start, end + 1);
  const attempts = [fragment, fragment.replace(/(?<=^|{|,)\s*([A-Za-z0-9_]+)\s*:/g, '"$1":')].map(
    (f) => f.replace(/,(\s*[}\]])/g, '$1')
  );

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt);
    } catch {
      // try next
    }
  }
  return null;
}

function repairTruncatedJson(raw: string): object | null {
  const start = raw.indexOf('{');
  if (start === -1) return null;
  let text = raw.slice(start);

  try {
    return JSON.parse(text);
  } catch {}

  let inString = false;
  let escape = false;
  const stack: string[] = [];
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === '\\' && inString) {
      escape = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      continue;
    }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (inString) text += '"';
  while (stack.length) text += stack.pop();

  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

// ── Prompt ─────────────────────────────────────────────────────────────

function buildTruthAnalysisPrompt(transcript: string, truncated: boolean): string {
  return [
    `You are a rigorous media analyst. Analyze the following transcript for assertions, logical fallacies, bias, and fact-checking needs.`,
    ``,
    `Transcript${truncated ? ' (truncated)' : ''}:`,
    `"""`,
    transcript,
    `"""`,
    ``,
    `Return ONLY valid JSON with this shape:`,
    `{`,
    `  "summary": "2-3 sentence overview of the content and its reliability",`,
    `  "assertions": [{"id":1,"text":"the claim","category":"claim|assumption|opinion|factual","confidence":0-1,"factCheckNeeded":true/false,"factCheckReason":"why it needs checking"}],`,
    `  "fallacies": [{"id":1,"name":"fallacy name","description":"explanation","assertionIds":[1],"severity":"minor|moderate|major","confidence":0-1}],`,
    `  "biases": [{"id":1,"type":"bias type","description":"explanation","direction":"e.g. pro-X","evidence":"specific evidence","confidence":0-1}],`,
    `  "overallCredibility": 0-10,`,
    `  "overallBiasLevel": "low|moderate|high",`,
    `  "keyAssumptions": ["assumption 1","assumption 2"],`,
    `  "recommendedFactChecks": ["check 1","check 2"]`,
    `}`,
    ``,
    `Rules:`,
    `- assertions: extract ALL distinct claims, opinions, assumptions, and factual statements. category must be one of: claim, assumption, opinion, factual`,
    `- fallacies: identify logical fallacies (straw man, ad hominem, false dilemma, slippery slope, etc.). severity: minor/moderate/major`,
    `- biases: identify framing bias, selection bias, confirmation bias, etc. Include direction if detectable`,
    `- overallCredibility: 0 = completely unreliable, 10 = highly credible and well-sourced`,
    `- overallBiasLevel: low/moderate/high`,
    `- Be thorough but precise. Only flag real fallacies and biases, not mere disagreements`,
    `- Respond with JSON only. No commentary outside the JSON object.`,
  ].join('\n');
}

// ── Gemini ─────────────────────────────────────────────────────────────

export async function analyzeTranscriptWithGemini(params: {
  apiKey: string;
  modelName?: string;
  transcript: string;
}): Promise<TruthAnalysisResult> {
  const { apiKey, modelName = process.env.GEMINI_MODEL, transcript } = params;

  const baseUrl = 'https://generativelanguage.googleapis.com/v1beta';

  async function pickDefaultModel(): Promise<string> {
    const res = await fetch(`${baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
    const json = await res.json();
    if (!res.ok) throw new Error(`ListModels failed (${res.status}): ${JSON.stringify(json)}`);
    const models = (json.models || []) as Array<{
      name: string;
      supportedGenerationMethods?: string[];
    }>;
    const supported = models.filter((m) =>
      (m.supportedGenerationMethods || []).includes('generateContent')
    );
    const flash = supported.find((m) => /gemini/i.test(m.name) && /flash/i.test(m.name));
    if (flash) return flash.name;
    const pro = supported.find((m) => /gemini/i.test(m.name) && /pro/i.test(m.name));
    if (pro) return pro.name;
    if (supported[0]) return supported[0].name;
    throw new Error('No models available that support generateContent');
  }

  let chosenModel = modelName || (await pickDefaultModel());
  if (!chosenModel.startsWith('models/')) chosenModel = `models/${chosenModel}`;

  const maxChars = 30000;
  const truncated = transcript.length > maxChars;
  const trimmedTranscript = truncated ? transcript.slice(0, maxChars) + '...' : transcript;

  const prompt = buildTruthAnalysisPrompt(trimmedTranscript, truncated);

  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.2 },
  };

  const startedAt = Date.now();
  console.log(`[truth-analysis] Calling Gemini API (${chosenModel})...`);

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
      .join('') ?? JSON.stringify(json);

  const parsed = tryParseJsonLoose(text);
  if (!parsed) {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 300)}`);
  }

  const durationMs = Date.now() - startedAt;
  const costEstimate = estimateGeminiCost({
    transcriptChars: trimmedTranscript.length,
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

  console.log(`[truth-analysis] Gemini done in ${durationMs}ms`);

  return normalizeResult(parsed, costMeta);
}

// ── Ollama ─────────────────────────────────────────────────────────────

export async function analyzeTranscriptWithOllama(params: {
  transcript: string;
}): Promise<TruthAnalysisResult> {
  const { transcript } = params;

  const maxChars = Number(process.env.OLLAMA_MAX_TRANSCRIPT_CHARS) || 4000;
  const truncated = transcript.length > maxChars;
  const trimmedTranscript = truncated ? transcript.slice(0, maxChars) + '...' : transcript;

  const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
  const localDefault = 'http://127.0.0.1:11434';
  const dockerServiceDefault = 'http://ollama:11434';
  let baseUrl = configuredBaseUrl || localDefault;
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const prompt = buildTruthAnalysisPrompt(trimmedTranscript, truncated);

  const startedAt = Date.now();
  console.log(`[truth-analysis] Calling Ollama (${model})...`);

  let res;
  try {
    res = await fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.2, num_predict: 2048 },
      }),
    });
  } catch (err) {
    if (!configuredBaseUrl && baseUrl !== dockerServiceDefault) {
      baseUrl = dockerServiceDefault;
      res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.2, num_predict: 2048 },
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

  const rawText = (data?.response ?? '').toString();
  let parsed = tryParseJsonLoose(rawText);
  if (!parsed) parsed = repairTruncatedJson(rawText);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`Ollama returned unparseable response: ${rawText.slice(0, 200)}`);
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

  console.log(`[truth-analysis] Ollama done in ${durationMs}ms`);

  return normalizeResult(parsed, costMeta);
}

// ── Normalize ──────────────────────────────────────────────────────────

function normalizeResult(parsed: any, costMeta: LLMCostMeta): TruthAnalysisResult {
  const assertions: TruthAnalysisAssertion[] = Array.isArray(parsed.assertions)
    ? parsed.assertions.map((a: any, i: number) => ({
        id: a.id ?? i + 1,
        text: String(a.text || ''),
        category: ['claim', 'assumption', 'opinion', 'factual'].includes(a.category)
          ? a.category
          : 'claim',
        confidence: clamp(Number(a.confidence) || 0, 0, 1),
        factCheckNeeded: typeof a.factCheckNeeded === 'boolean' ? a.factCheckNeeded : false,
        factCheckReason: a.factCheckReason ? String(a.factCheckReason) : undefined,
      }))
    : [];

  const fallacies: TruthAnalysisFallacy[] = Array.isArray(parsed.fallacies)
    ? parsed.fallacies.map((f: any, i: number) => ({
        id: f.id ?? i + 1,
        name: String(f.name || ''),
        description: String(f.description || ''),
        assertionIds: Array.isArray(f.assertionIds) ? f.assertionIds.map(Number) : [],
        severity: ['minor', 'moderate', 'major'].includes(f.severity) ? f.severity : 'minor',
        confidence: clamp(Number(f.confidence) || 0, 0, 1),
      }))
    : [];

  const biases: TruthAnalysisBias[] = Array.isArray(parsed.biases)
    ? parsed.biases.map((b: any, i: number) => ({
        id: b.id ?? i + 1,
        type: String(b.type || ''),
        description: String(b.description || ''),
        direction: b.direction ? String(b.direction) : undefined,
        evidence: String(b.evidence || ''),
        confidence: clamp(Number(b.confidence) || 0, 0, 1),
      }))
    : [];

  const biasLevel = ['low', 'moderate', 'high'].includes(parsed.overallBiasLevel)
    ? (parsed.overallBiasLevel as 'low' | 'moderate' | 'high')
    : 'low';

  return {
    summary: String(parsed.summary || ''),
    assertions,
    fallacies,
    biases,
    overallCredibility: clamp(Number(parsed.overallCredibility) || 0, 0, 10),
    overallBiasLevel: biasLevel,
    keyAssumptions: Array.isArray(parsed.keyAssumptions) ? parsed.keyAssumptions.map(String) : [],
    recommendedFactChecks: Array.isArray(parsed.recommendedFactChecks)
      ? parsed.recommendedFactChecks.map(String)
      : [],
    _cost: costMeta,
  };
}
