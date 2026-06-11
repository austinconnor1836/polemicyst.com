import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

/**
 * POST /api/publish/generate-meta
 *
 * AI-generate a title + caption for a video. Same Ollama infra as
 * /api/social-posts/generate-description, but returns both fields and includes
 * platform-aware tone hints in the prompt so the result fits the target platforms.
 *
 * Per-platform overrides (different caption per platform) is a future iteration —
 * today we return a single caption that respects the strictest selected platform's
 * length cap.
 */
const dockerServiceDefault = 'http://ollama:11434';

const platformCaps: Record<string, { max: number; tone: string }> = {
  twitter: { max: 280, tone: 'punchy, ≤1 emoji, 1 hashtag max' },
  bluesky: { max: 300, tone: 'conversational, 0-1 hashtag' },
  youtube: { max: 5000, tone: 'descriptive, 2-3 hashtags, suitable for a Shorts caption' },
  instagram: { max: 2200, tone: 'lifestyle voice, 3-5 hashtags' },
  tiktok: { max: 2200, tone: 'trendy, 3-5 hashtags, hook in first line' },
};

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: {
    context?: string;
    platforms?: string[];
    seedTitle?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const platforms = (body.platforms ?? []).filter((p): p is string => typeof p === 'string');
  const context = (body.context ?? '').slice(0, 2000);
  const seedTitle = (body.seedTitle ?? '').slice(0, 200);

  const selectedCaps = platforms.map((p) => platformCaps[p]).filter(Boolean);
  // Use the tightest character cap so the caption fits ALL selected platforms.
  const captionMax = selectedCaps.length > 0 ? Math.min(...selectedCaps.map((p) => p.max)) : 250;
  const toneLines = selectedCaps.map((p, i) => `- ${platforms[i]}: ${p.tone}`).join('\n');

  const prompt = [
    'You are a social media copywriter. Generate a TITLE and a CAPTION for a short video being published on social media.',
    '',
    'Context about the video:',
    seedTitle ? `Working title: ${seedTitle}` : '',
    context || 'A short video produced by the user.',
    '',
    `Target platforms: ${platforms.length > 0 ? platforms.join(', ') : 'general social media'}`,
    selectedCaps.length > 0 ? `Platform tone hints:\n${toneLines}` : '',
    '',
    'Output a JSON object with EXACTLY this shape and no other text:',
    '{"title":"...","caption":"..."}',
    '',
    'Requirements:',
    '- title: 4-10 words, no hashtags, no quotes',
    `- caption: ≤${captionMax} characters, 1-3 sentences, casual and engaging`,
    '- caption should include 1-4 relevant hashtags depending on platform tone above',
    '- Do NOT include any URLs or links',
    '- Do NOT use markdown formatting',
    '- Return ONLY the JSON object',
  ]
    .filter(Boolean)
    .join('\n');

  const configuredBaseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL || 'llama3';
  let baseUrl = configuredBaseUrl || 'http://127.0.0.1:11434';

  async function callOllama(url: string) {
    return fetch(`${url}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { temperature: 0.7, num_predict: 384 },
      }),
    });
  }

  let res: Response;
  try {
    try {
      res = await callOllama(baseUrl);
    } catch (err) {
      if (!configuredBaseUrl && baseUrl !== dockerServiceDefault) {
        baseUrl = dockerServiceDefault;
        res = await callOllama(baseUrl);
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.error('[generate-meta] Ollama connection failed:', err.message);
    return NextResponse.json(
      { error: 'AI service unavailable. Is Ollama running?' },
      { status: 503 }
    );
  }

  if (!res.ok) {
    const text = await res.text();
    console.error('[generate-meta] Ollama error:', text);
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
  }

  const data = await res.json();
  const raw = (data.response || '').trim();

  // The model may emit text around the JSON; try to extract the first {...} block.
  let title = '';
  let caption = '';
  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      title = typeof parsed.title === 'string' ? parsed.title.trim() : '';
      caption = typeof parsed.caption === 'string' ? parsed.caption.trim() : '';
    }
  } catch (err) {
    console.warn('[generate-meta] JSON parse failed, falling back to plain text');
  }

  if (!title && !caption) {
    // Last-resort fallback: treat the whole response as the caption.
    caption = raw;
  }

  return NextResponse.json({ title, caption });
}
