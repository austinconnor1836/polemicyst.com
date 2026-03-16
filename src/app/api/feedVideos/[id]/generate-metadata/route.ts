import { NextRequest, NextResponse } from 'next/server';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST /api/feedVideos/:id/generate-metadata
 *
 * Generates a title and description for a FeedVideo using its transcript.
 * Uses Gemini (preferred) or Ollama as the LLM provider.
 * Called automatically after transcription completes, or manually by the user.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthenticatedUser(req);
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const feedVideo = await prisma.feedVideo.findUnique({
    where: { id },
    select: { id: true, userId: true, transcript: true, title: true },
  });

  if (!feedVideo || feedVideo.userId !== user.id) {
    return NextResponse.json({ error: 'Feed video not found' }, { status: 404 });
  }

  if (!feedVideo.transcript) {
    return NextResponse.json(
      { error: 'No transcript available yet. Transcribe the video first.' },
      { status: 400 }
    );
  }

  try {
    const result = await generateMetadata(feedVideo.transcript);

    await prisma.feedVideo.update({
      where: { id },
      data: { title: result.title },
    });

    return NextResponse.json({
      ok: true,
      title: result.title,
      description: result.description,
    });
  } catch (err: any) {
    console.error('[generate-metadata] Failed:', err);
    return NextResponse.json(
      { error: err.message || 'Metadata generation failed' },
      { status: 500 }
    );
  }
}

interface MetadataResult {
  title: string;
  description: string;
}

async function generateMetadata(transcript: string): Promise<MetadataResult> {
  const prompt = `Given the following video transcript, generate a concise, descriptive title and a brief description.
Return ONLY valid JSON: {"title": "...", "description": "..."}

Transcript:
"""
${transcript.slice(0, 8000)}
"""`;

  // Try Gemini first
  const geminiKey = process.env.GOOGLE_API_KEY;
  if (geminiKey) {
    return generateWithGemini(geminiKey, prompt);
  }

  // Fall back to Ollama
  return generateWithOllama(prompt);
}

async function generateWithGemini(apiKey: string, prompt: string): Promise<MetadataResult> {
  const model = 'gemini-2.0-flash';
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.7,
      },
    }),
  });

  if (!res.ok) {
    throw new Error(`Gemini API error: ${res.status}`);
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return parseMetadataJson(text);
}

async function generateWithOllama(prompt: string): Promise<MetadataResult> {
  const baseUrl = (process.env.OLLAMA_BASE_URL || 'http://localhost:11434').replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const res = await fetch(`${baseUrl}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt,
      stream: false,
      format: 'json',
      options: { temperature: 0.7 },
    }),
  });

  if (!res.ok) {
    throw new Error(`Ollama API error: ${res.status}`);
  }

  const data = (await res.json()) as any;
  return parseMetadataJson(data.response);
}

function parseMetadataJson(text: string): MetadataResult {
  try {
    const parsed = JSON.parse(text);
    return {
      title: parsed.title || 'Untitled Video',
      description: parsed.description || '',
    };
  } catch {
    throw new Error('Failed to parse LLM metadata response');
  }
}
