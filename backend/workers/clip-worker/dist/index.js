"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bullmq_1 = require("bullmq");
const ioredis_1 = __importDefault(require("ioredis"));
// @ts-ignore
const prisma_1 = require("./shared/lib/prisma");
const child_process_1 = require("child_process");
const fs_1 = require("fs");
const fs = __importStar(require("fs/promises"));
const path = __importStar(require("path"));
const node_fetch_1 = __importDefault(require("node-fetch"));
// Configuration
const REDIS_HOST = process.env.REDIS_HOST || 'localhost';
const REDIS_PORT = parseInt(process.env.REDIS_PORT || '6379');
const redisConnection = new ioredis_1.default({
    host: REDIS_HOST,
    port: REDIS_PORT,
    maxRetriesPerRequest: null,
});
// Queues for scoring
const provocativenessQueue = new bullmq_1.Queue('score-provocativeness', { connection: redisConnection });
const comedicQueue = new bullmq_1.Queue('score-comedic', { connection: redisConnection });
const provocativenessEvents = new bullmq_1.QueueEvents('score-provocativeness', { connection: redisConnection });
const comedicEvents = new bullmq_1.QueueEvents('score-comedic', { connection: redisConnection });
// Helper: Download video
async function downloadVideo(url, dest) {
    const res = await (0, node_fetch_1.default)(url);
    if (!res.ok || !res.body)
        throw new Error(`Failed to download video: ${res.statusText}`);
    const stream = (0, fs_1.createWriteStream)(dest);
    await new Promise((resolve, reject) => {
        res.body.pipe(stream);
        res.body.on('error', (e) => reject(e));
        stream.on('finish', () => resolve());
    });
}
// Helper: Transcribe
async function transcribeVideo(videoPath) {
    return new Promise((resolve, reject) => {
        const python = (0, child_process_1.spawn)('python3', ['scripts/transcribe.py', videoPath]);
        let output = '';
        let error = '';
        python.stdout.on('data', d => output += d.toString());
        python.stderr.on('data', d => error += d.toString());
        python.on('close', code => {
            if (code !== 0)
                return reject(new Error(`Transcription failed: ${error}`));
            try {
                const parsed = JSON.parse(output);
                resolve(parsed.segments);
            }
            catch (e) {
                reject(new Error(`Invalid JSON: ${e}`));
            }
        });
    });
}
// Helper: Generate Clip (FFmpeg)
async function createClip(videoPath, start, end, text, outPath, aspectRatio) {
    const srtPath = outPath.replace('.mp4', '.srt');
    const sTime = "00:00:00,000";
    const duration = end - start;
    const dDate = new Date(duration * 1000).toISOString().substring(11, 23).replace('.', ',');
    const srt = `1\n${sTime} --> ${dDate}\n${text}\n`;
    await fs.writeFile(srtPath, srt);
    const aspectRatioFilter = (() => {
        switch (aspectRatio) {
            case '16:9': return 'scale=1280:720,setsar=1';
            case '1:1': return 'scale=720:720,setsar=1';
            case '9:16':
            default: return 'scale=720:1280,setsar=1';
        }
    })();
    return new Promise((resolve, reject) => {
        const ffmpeg = (0, child_process_1.spawn)('ffmpeg', [
            '-y',
            '-i', videoPath,
            '-ss', `${start}`,
            '-to', `${end}`,
            '-vf', `${aspectRatioFilter},subtitles=${srtPath.replace(/:/g, '\\:')}`,
            '-c:v', 'libx264',
            '-c:a', 'aac',
            outPath,
        ]);
        ffmpeg.on('close', code => {
            if (code === 0)
                resolve();
            else
                reject(new Error(`FFmpeg failed (${code})`));
        });
    });
}
// Main Worker
new bullmq_1.Worker('clip-generation', async (job) => {
    const { feedVideoId, userId, aspectRatio } = job.data;
    console.log(`📥 Processing clip-generation for ${feedVideoId}`);
    try {
        // 1. Fetch Video Info
        const feedVideo = await prisma_1.prisma.feedVideo.findUnique({ where: { id: feedVideoId } });
        if (!feedVideo || !feedVideo.s3Url)
            throw new Error('Video not found or missing S3 URL');
        const tempDir = `/tmp/${feedVideoId}`;
        await fs.mkdir(tempDir, { recursive: true });
        const videoPath = path.join(tempDir, 'source.mp4');
        // 2. Download
        console.log('⬇️ Downloading video...');
        await downloadVideo(feedVideo.s3Url, videoPath);
        // 3. Transcribe
        console.log('🎤 Transcribing...');
        const segments = await transcribeVideo(videoPath);
        // Save transcript to DB
        await prisma_1.prisma.feedVideo.update({
            where: { id: feedVideoId },
            data: {
                transcript: segments.map(s => s.text).join(' '),
                transcriptJson: segments,
            }
        });
        // 4. Score Segments (Windowing)
        const windows = [];
        for (let i = 0; i < segments.length; i += 3) {
            const group = segments.slice(i, i + 3);
            const text = group.map(s => s.text).join(' ');
            const start = group[0].start;
            const end = group[group.length - 1].end;
            windows.push({ start, end, text, index: i });
        }
        console.log(`🧠 Scoring ${windows.length} windows...`);
        const scoredWindows = await Promise.all(windows.map(async (w) => {
            // Dispatch jobs
            const pJob = await provocativenessQueue.add('score', { transcript: w.text });
            const cJob = await comedicQueue.add('score', { transcript: w.text });
            // Wait for results
            const [pResult, cResult] = await Promise.all([
                pJob.waitUntilFinished(provocativenessEvents),
                cJob.waitUntilFinished(comedicEvents)
            ]);
            return {
                ...w,
                provocativeness: pResult.score,
                comedic: cResult.score,
                pReasoning: pResult.reasoning,
                cReasoning: cResult.reasoning
            };
        }));
        // 5. Select Best Clips
        const topProvocative = [...scoredWindows].sort((a, b) => b.provocativeness - a.provocativeness).slice(0, 2);
        const topComedic = [...scoredWindows].sort((a, b) => b.comedic - a.comedic).slice(0, 2);
        const selected = new Set([...topProvocative, ...topComedic]);
        console.log(`✂️ Generating ${selected.size} clips...`);
        const clips = [];
        for (const w of selected) {
            const outPath = path.join(tempDir, `clip-${w.index}.mp4`);
            await createClip(videoPath, w.start, w.end, w.text, outPath, aspectRatio || '9:16');
            console.log(`✅ Generated clip: ${outPath} (P: ${w.provocativeness}, C: ${w.comedic})`);
            // Create Video entry in DB
            await prisma_1.prisma.video.create({
                data: {
                    userId,
                    videoTitle: `Viral Clip ${w.index}`,
                    s3Url: `file://${outPath}`, // Placeholder
                    s3Key: `clips/${feedVideoId}/${w.index}`,
                    transcript: w.text,
                    approvedForSplicing: false,
                    fileName: `clip-${w.index}.mp4`,
                    sharedDescription: "",
                    facebookTemplate: "",
                    instagramTemplate: "",
                    youtubeTemplate: "",
                    blueskyTemplate: "",
                    twitterTemplate: ""
                }
            });
        }
        // Cleanup
        await fs.rm(tempDir, { recursive: true, force: true });
        console.log('🏁 Job complete');
    }
    catch (err) {
        console.error('❌ Job failed:', err);
        throw err;
    }
}, { connection: redisConnection });
