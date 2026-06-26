export interface MetadataResult {
  title: string;
  description: string;
}

export async function generateMetadataWithOllama(transcript: string): Promise<MetadataResult> {
  // OLLAMA_BASE_URL must be provided by env (Docker compose sets it to the ollama
  // service host; local dev sets it to the host loopback). We refuse to fall back to
  // a default because a silent loopback call in prod would either hang or hit the
  // wrong machine.
  const ollamaBase = process.env.OLLAMA_BASE_URL;
  if (!ollamaBase) {
    throw new Error('OLLAMA_BASE_URL env var is required to use the Ollama metadata provider');
  }
  const baseUrl = ollamaBase.replace(/\/$/, '');
  const model = process.env.OLLAMA_MODEL || 'llama3';

  const prompt = `
You are a YouTube video optimization expert.
Given the following transcript, generate a clickbait-style title and a compelling description.
Return ONLY valid JSON in this format:
{
  "title": "Your Title Here",
  "description": "Your Description Here"
}

Transcript:
"""
${transcript.slice(0, 10000)}
"""
`.trim();

  try {
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
      throw new Error(`Ollama API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as any;
    const responseText = data.response;

    // Parse JSON from response
    try {
      const parsed = JSON.parse(responseText);
      return {
        title: parsed.title || 'Untitled Video',
        description: parsed.description || 'No description available.',
      };
    } catch (e) {
      console.error('Failed to parse Ollama JSON response:', responseText);
      // Fallback to extraction if strict JSON fails
      // But 'format: json' should enforce it reliably with recent Ollama versions/models
      throw new Error('Invalid JSON from Ollama');
    }
  } catch (err: any) {
    console.error('Error in generateMetadataWithOllama:', err);
    throw err;
  }
}
