import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';

const dockerServiceDefault = 'http://ollama:11434';

export async function POST(req: NextRequest) {
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { title?: string; trackLabels?: string[]; layouts?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { title, trackLabels = [], layouts = [] } = body;

  const contextLines = [
    title ? `Title: ${title}` : '',
    trackLabels.length > 0 ? `Reference clips: ${trackLabels.join(', ')}` : '',
    layouts.length > 0 ? `Output formats: ${layouts.join(', ')}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const prompt = [
    'You are a social media copywriter. Write a short, engaging post description for a reaction video being published on social media.',
    '',
    'Context about the video:',
    contextLines || 'A reaction composition video.',
    '',
    'Requirements:',
    '- 1-3 sentences, casual and engaging tone',
    '- Include relevant hashtags (2-4)',
    '- Do NOT include any URLs or links',
    '- Do NOT use markdown formatting',
    '- Keep it under 250 characters total so it fits on all platforms',
    '- Return ONLY the post text, nothing else',
  ].join('\n');

  const configuredBaseUrl = process.env.OLLAMA_BASE_URL;
  const model = process.env.OLLAMA_MODEL || 'llama3';
  let baseUrl = configuredBaseUrl || 'http://127.0.0.1:11434';

  let res;
  try {
    try {
      res = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model,
          prompt,
          stream: false,
          options: { temperature: 0.7, num_predict: 256 },
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
            options: { temperature: 0.7, num_predict: 256 },
          }),
        });
      } else {
        throw err;
      }
    }
  } catch (err: any) {
    console.error('[generate-description] Ollama connection failed:', err.message);
    return NextResponse.json(
      { error: 'AI service unavailable. Is Ollama running?' },
      { status: 503 }
    );
  }

  if (!res.ok) {
    const text = await res.text();
    console.error('[generate-description] Ollama error:', text);
    return NextResponse.json({ error: 'AI generation failed' }, { status: 502 });
  }

  const data = await res.json();
  const description = (data.response || '').trim();

  return NextResponse.json({ description });
}
