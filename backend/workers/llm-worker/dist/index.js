"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const zod_1 = require("zod");
// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const OLLAMA_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434';
const SCORING_TYPE = process.env.SCORING_TYPE || 'PROVOCATIVENESS'; // PROVOCATIVENESS | COMEDIC
const MODEL_NAME = process.env.MODEL_NAME || 'llama3';
// Redis Connection
const connection = new ioredis_1.default({
    host: REDIS_HOST,
    port: REDIS_PORT,
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
`
};
const ResponseSchema = zod_1.z.object({
    score: zod_1.z.number(),
    reasoning: zod_1.z.string(),
});
async function queryOllama(prompt, transcript) {
    const fullPrompt = `${prompt}\n${transcript}`;
    try {
        const response = await fetch(`${OLLAMA_HOST}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: MODEL_NAME,
                prompt: fullPrompt,
                stream: false,
                format: "json"
            }),
        });
        if (!response.ok) {
            throw new Error(`Ollama API error: ${response.statusText}`);
        }
        const data = await response.json();
        const parsed = JSON.parse(data.response);
        return ResponseSchema.parse(parsed);
    }
    catch (error) {
        console.error('Error querying Ollama:', error);
        throw error;
    }
}
const queueName = `score-${SCORING_TYPE.toLowerCase()}`;
console.log(`🚀 Starting LLM Worker for ${SCORING_TYPE} on queue: ${queueName}`);
const worker = new bullmq_1.Worker(queueName, async (job) => {
    console.log(`Processing job ${job.id} for ${SCORING_TYPE}`);
    const { transcript } = job.data;
    if (!transcript) {
        throw new Error('Transcript is required');
    }
    const prompt = PROMPTS[SCORING_TYPE];
    if (!prompt) {
        throw new Error(`Unknown scoring type: ${SCORING_TYPE}`);
    }
    const result = await queryOllama(prompt, transcript);
    console.log(`Job ${job.id} completed. Score: ${result.score}`);
    return result;
}, { connection });
worker.on('completed', (job) => {
    console.log(`Job ${job.id} has completed!`);
});
worker.on('failed', (job, err) => {
    console.log(`Job ${job?.id} has failed with ${err.message}`);
});
