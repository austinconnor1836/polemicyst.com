import express, { Request, Response } from 'express';
import fetch from 'node-fetch';

const router = express.Router();

router.post('/', async (req: Request, res: Response): Promise<any> => {
  const { transcript } = req.body as { transcript?: string };

  if (!transcript) {
    return res.status(400).json({ error: 'Missing transcript in request body' });
  }

  try {
    const configuredBaseUrl = (process.env.OLLAMA_BASE_URL || '').replace(/\/$/, '');
    const localDefault = 'http://127.0.0.1:11434';
    const dockerServiceDefault = 'http://ollama:11434';
    const baseUrl = configuredBaseUrl || localDefault;

    const requestBody = {
      model: process.env.OLLAMA_MODEL || 'llama3',
      prompt: `Write a compelling YouTube-style description and title for the following transcript:\n\n"${transcript}"\n\nReturn a JSON object like: {"description": "...", "title": "...", "hashtags": ["..."]}`,
      stream: true,
    };

    let ollamaRes;
    try {
      ollamaRes = await fetch(`${baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      });
    } catch (err) {
      if (!configuredBaseUrl) {
        ollamaRes = await fetch(`${dockerServiceDefault}/api/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        });
      } else {
        throw err;
      }
    }

    let raw = '';
    for await (const chunk of ollamaRes.body as NodeJS.ReadableStream) {
      raw += chunk.toString();
    }

    let combined = '';
    raw.split('\n').forEach((line) => {
      if (line.trim()) {
        try {
          const parsed = JSON.parse(line);
          combined += parsed.response || '';
        } catch (e: any) {
          console.warn('Skipping line parse error:', e.message);
        }
      }
    });

    const jsonStart = combined.indexOf('{');
    const jsonEnd = combined.lastIndexOf('}');
    const jsonString = combined.slice(jsonStart, jsonEnd + 1);
    const parsed = JSON.parse(jsonString);

    return res.json(parsed);
  } catch (err: any) {
    console.error('Ollama generation error:', err);
    return res.status(500).json({ error: 'Failed to generate description', details: err.message });
  }
});

export default router;
