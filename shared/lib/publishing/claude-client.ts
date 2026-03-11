import Anthropic from '@anthropic-ai/sdk';
import type { LLMCostMeta } from '../scoring/llm-types';
import type {
  GenerateArticleParams,
  GenerateArticleResult,
  GenerateGraphicsParams,
  GenerateGraphicsResult,
  GraphicType,
} from './types';

// ── Client singleton ────────────────────────────────────────────────────

let _client: Anthropic | null = null;

function getClient(): Anthropic {
  if (!_client) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not configured');
    _client = new Anthropic({ apiKey });
  }
  return _client;
}

const MODEL = 'claude-sonnet-4-5';

// ── Article generation ──────────────────────────────────────────────────

export async function generateArticle(
  params: GenerateArticleParams
): Promise<GenerateArticleResult> {
  const client = getClient();

  const systemPrompt = [
    `You are the writing engine for a digital publication. The publication's full identity, voice, design system, and analytical frameworks are defined below. Follow them exactly.`,
    ``,
    `--- PUBLICATION CONFIG ---`,
    params.publicationConfigMarkdown,
    `--- END CONFIG ---`,
    ``,
    `When generating an article:`,
    `1. Write in the voice and tone defined in the config.`,
    `2. Apply the analytical frameworks where relevant.`,
    `3. Structure the article with a compelling title, optional subtitle, and well-structured body.`,
    `4. Use markdown formatting for the body (headers, bold, lists, blockquotes).`,
    `5. Return your response as JSON with this exact structure:`,
    `{`,
    `  "title": "Article Title",`,
    `  "subtitle": "Optional subtitle",`,
    `  "bodyMarkdown": "Full article in markdown",`,
    `  "bodyHtml": "Full article in HTML (converted from the markdown, with <h2>, <p>, <blockquote>, <strong>, <em>, <ul>/<li> tags)",`,
    `  "tags": ["tag1", "tag2"]`,
    `}`,
    ``,
    `Return ONLY the JSON object, no other text.`,
  ].join('\n');

  const userContent = [
    `Topic: ${params.topic}`,
    params.sourceContent ? `\nSource material:\n"""\n${params.sourceContent}\n"""` : '',
    params.instructions ? `\nAdditional instructions: ${params.instructions}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const startedAt = Date.now();
  console.log(`[publishing] Generating article via Claude (${MODEL})...`);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const response = await stream.finalMessage();

  const durationMs = Date.now() - startedAt;
  const text =
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';

  if (!text) {
    throw new Error('Claude returned empty response for article generation');
  }

  // Parse JSON response — handle potential markdown code fences
  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: {
    title: string;
    subtitle?: string;
    bodyMarkdown: string;
    bodyHtml: string;
    tags?: string[];
  };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse article JSON from Claude: ${text.slice(0, 500)}`);
  }

  const costMeta: LLMCostMeta = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd:
      (response.usage.input_tokens / 1_000_000) * 3.0 +
      (response.usage.output_tokens / 1_000_000) * 15.0,
    modelName: MODEL,
    durationMs,
  };

  console.log(`[publishing] Article generated in ${durationMs}ms`);

  return {
    title: parsed.title,
    subtitle: parsed.subtitle,
    bodyMarkdown: parsed.bodyMarkdown,
    bodyHtml: parsed.bodyHtml,
    tags: parsed.tags,
    _cost: costMeta,
  };
}

// ── Graphics generation ─────────────────────────────────────────────────

const DEFAULT_GRAPHIC_TYPES: GraphicType[] = ['hero', 'pull-quote', 'masthead'];

export async function generateGraphics(
  params: GenerateGraphicsParams
): Promise<GenerateGraphicsResult> {
  const client = getClient();
  const types = params.types ?? DEFAULT_GRAPHIC_TYPES;

  const systemPrompt = [
    `You are a graphic designer for a digital publication. The publication's design system is defined in the config below. Follow the colors, fonts, and aesthetic exactly.`,
    ``,
    `--- PUBLICATION CONFIG ---`,
    params.publicationConfigMarkdown,
    `--- END CONFIG ---`,
    ``,
    `Generate HTML graphics for an article. Each graphic should be a self-contained HTML snippet with:`,
    `- Inline CSS (no external stylesheets)`,
    `- Google Fonts loaded via @import in a <style> tag`,
    `- Fixed dimensions suitable for social media / web (1200x630 for hero, 800x800 for pull-quote, 1200x200 for masthead, 1200x100 for divider)`,
    `- The publication's color palette and typography from the config`,
    ``,
    `Return your response as JSON with this exact structure:`,
    `{`,
    `  "graphics": [`,
    `    {`,
    `      "type": "hero|pull-quote|masthead|divider",`,
    `      "label": "Description of the graphic",`,
    `      "htmlContent": "<div style='...'>...</div>"`,
    `    }`,
    `  ]`,
    `}`,
    ``,
    `Return ONLY the JSON object, no other text.`,
  ].join('\n');

  const userContent = [
    `Article title: ${params.articleTitle}`,
    ``,
    `Article body (excerpt):`,
    `"""`,
    params.articleBody.slice(0, 8000),
    `"""`,
    ``,
    `Generate the following graphic types: ${types.join(', ')}`,
  ].join('\n');

  const startedAt = Date.now();
  console.log(`[publishing] Generating graphics via Claude (${MODEL})...`);

  const stream = client.messages.stream({
    model: MODEL,
    max_tokens: 16000,
    system: systemPrompt,
    messages: [{ role: 'user', content: userContent }],
  });

  const response = await stream.finalMessage();

  const durationMs = Date.now() - startedAt;
  const text =
    response.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('') ?? '';

  if (!text) {
    throw new Error('Claude returned empty response for graphics generation');
  }

  let jsonStr = text.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
  }

  let parsed: { graphics: Array<{ type: GraphicType; label: string; htmlContent: string }> };
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse graphics JSON from Claude: ${text.slice(0, 500)}`);
  }

  const costMeta: LLMCostMeta = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    estimatedCostUsd:
      (response.usage.input_tokens / 1_000_000) * 3.0 +
      (response.usage.output_tokens / 1_000_000) * 15.0,
    modelName: MODEL,
    durationMs,
  };

  console.log(`[publishing] Graphics generated in ${durationMs}ms`);

  return {
    graphics: parsed.graphics,
    _cost: costMeta,
  };
}
