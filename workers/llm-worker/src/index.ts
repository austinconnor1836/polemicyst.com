import { Worker, Job } from 'bullmq';
import { z } from 'zod';
import Redis from 'ioredis';

const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const SCORING_TYPE = process.env.SCORING_TYPE || 'PROVOCATIVENESS';
const MODEL_NAME = process.env.MODEL_NAME || 'llama3';

const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

// Prompts
const PROMPTS = {
  PROVOCATIVENESS: `You are an expert social media analyst. Analyze the following transcript for "provocativeness" - defined as controversial, edgy, or debate-sparking content that drives engagement.
Return ONLY a JSON object with the following format:
{
  "score": <number between 0-100>,
  "reasoning": "<short explanation>"
}
Transcript:
`,
  COMEDIC: `You are an expert comedy scout. Analyze the following transcript for "comedic value" - defined as funny, witty, or entertaining content.
Return ONLY a JSON object with the following format:
{
  "score": <number between 0-100>,
  "reasoning": "<short explanation>"
}
Transcript:
`,
};

const ResponseSchema = z.object({
  score: z.number(),
  reasoning: z.string(),
});

async function queryOllama(prompt: string, transcript: string) {
  const fullPrompt = `${prompt}\n${transcript}`;

  try {
    const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_NAME,
        prompt: fullPrompt,
        stream: false,
        format: 'json',
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.statusText}`);
    }

    const data = (await response.json()) as any;
    const parsed = JSON.parse(data.response);
    return ResponseSchema.parse(parsed);
  } catch (error) {
    console.error('Error querying Ollama:', error);
    throw error;
  }
}

const queueName = `score-${SCORING_TYPE.toLowerCase()}`;

console.log(`🚀 Starting LLM Worker for ${SCORING_TYPE} on queue: ${queueName}`);

const worker = new Worker(
  queueName,
  async (job: Job) => {
    console.log(`Processing job ${job.id} for ${SCORING_TYPE}`);
    const { transcript } = job.data;

    if (!transcript) {
      throw new Error('Transcript is required');
    }

    const prompt = PROMPTS[SCORING_TYPE as keyof typeof PROMPTS];
    if (!prompt) {
      throw new Error(`Unknown scoring type: ${SCORING_TYPE}`);
    }

    const result = await queryOllama(prompt, transcript);
    console.log(`Job ${job.id} completed. Score: ${result.score}`);
    return result;
  },
  { connection: connection as any }
);

worker.on('completed', (job) => {
  console.log(`Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});
