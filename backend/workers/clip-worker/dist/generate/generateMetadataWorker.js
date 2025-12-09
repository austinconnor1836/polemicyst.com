"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
const node_fetch_1 = __importDefault(require("node-fetch"));
// @ts-ignore
const prisma_1 = require("../../shared/lib/prisma");
const redis = new ioredis_1.default({
    host: process.env.REDIS_HOST || 'localhost',
    port: 6379,
    maxRetriesPerRequest: null,
});
new bullmq_1.Worker('generate-metadata', async (job) => {
    const { videoId, transcript } = job.data;
    try {
        const res = await (0, node_fetch_1.default)('http://backend:3001/api/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ transcript })
        });
        const data = await res.json();
        if (!data.title || !data.description) {
            throw new Error('Missing title or description from Ollama response');
        }
        await prisma_1.prisma.video.update({
            where: { id: videoId },
            data: {
                videoTitle: data.title,
                sharedDescription: data.description,
            }
        });
        console.log(`✅ Metadata updated for video ${videoId}`);
    }
    catch (err) {
        console.error(`❌ Failed to generate metadata for video ${videoId}:`, err.message);
        throw err; // Mark job as failed → retry if attempts set
    }
}, { connection: redis });
