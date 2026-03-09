/**
 * Training Data Seed Script
 *
 * Ingests videos from public YouTube channels, transcribes them, scores with LLM,
 * and collects training examples for model distillation.
 *
 * Uses yt-dlp for channel listing and video download (no Google API key needed for listing).
 *
 * Usage:
 *   npx tsx scripts/seed-training-data.ts --channels all --limit 1 --provider gemini
 *   npx tsx scripts/seed-training-data.ts --channels fox,cnn --limit 5
 *   npx tsx scripts/seed-training-data.ts --channels all --limit 25 --provider gemini
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.local', override: false });

import { prisma } from '../shared/lib/prisma';
import { fetchYouTubeCaptions } from '../shared/lib/youtube-captions';
import {
  buildCandidatesFromTranscript,
  scoreAndRankCandidatesLLM,
} from '../shared/lib/scoring/viral-scoring';
import { TrainingCollector } from '../shared/lib/training-collector';
import { CostTracker } from '../shared/lib/cost-tracking';
import { downloadFeedVideoToTemp } from '../shared/util/download';
import { spawn } from 'child_process';
import fs from 'fs';

// Dedicated userId for seed data (constant cuid so it's identifiable)
const TRAINING_SEED_USER_ID = 'cltrainingseed000000000000';

// Public YouTube channel URLs
const CHANNELS: Record<string, { name: string; url: string }> = {
  fox: { name: 'Fox News', url: 'https://www.youtube.com/@FoxNews' },
  msnbc: { name: 'MSNBC', url: 'https://www.youtube.com/@MSNBC' },
  cnn: { name: 'CNN', url: 'https://www.youtube.com/@CNN' },
  bulwark: { name: 'The Bulwark', url: 'https://www.youtube.com/@BulwarkMedia' },
  lincoln: { name: 'The Lincoln Project', url: 'https://www.youtube.com/@TheLincolnProject' },
  profg: { name: 'Prof G (Scott Galloway)', url: 'https://www.youtube.com/@profgshow' },
  pivot: { name: 'Kara Swisher / Pivot (Vox)', url: 'https://www.youtube.com/@pivotpodcast' },
  pbs: { name: 'PBS NewsHour', url: 'https://www.youtube.com/@PBSNewsHour' },
  nbc: { name: 'NBC News', url: 'https://www.youtube.com/@NBCNews' },
  abc: { name: 'ABC News', url: 'https://www.youtube.com/@ABCNews' },
};

/**
 * Use yt-dlp to list recent video IDs + titles from a channel URL.
 * --flat-playlist avoids downloading anything, just lists metadata.
 */
async function fetchChannelVideos(
  channelUrl: string,
  limit: number
): Promise<Array<{ videoId: string; title: string }>> {
  return new Promise((resolve) => {
    const args = [
      '--flat-playlist',
      '--print',
      '%(id)s\t%(title)s',
      '--playlist-end',
      String(limit),
      `${channelUrl}/videos`,
    ];

    const child = spawn('yt-dlp', args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (d) => (stdout += d.toString()));
    child.stderr.on('data', (d) => (stderr += d.toString()));

    child.on('close', (code) => {
      if (code !== 0) {
        console.error(`  yt-dlp listing failed (code ${code}): ${stderr.slice(0, 200)}`);
        resolve([]);
        return;
      }

      const videos = stdout
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((line) => {
          const [videoId, ...titleParts] = line.split('\t');
          return { videoId, title: titleParts.join('\t') || videoId };
        });

      resolve(videos);
    });
  });
}

async function processVideo(
  videoId: string,
  title: string,
  channelName: string,
  provider: string
): Promise<number> {
  const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
  const jobId = `seed-${videoId}`;

  // Check if already processed
  const existing = await prisma.trainingExample.findFirst({
    where: { jobId, userId: TRAINING_SEED_USER_ID },
    select: { id: true },
  });
  if (existing) {
    console.log(`  ⏭️  Already processed ${videoId}, skipping`);
    return 0;
  }

  // 1. Fetch captions (fast path, no video download needed)
  console.log(`  📝 Fetching captions for "${title}"...`);
  const captions = await fetchYouTubeCaptions(youtubeUrl);
  if (!captions || captions.segments.length === 0) {
    console.log(`  ⚠️  No captions available, skipping`);
    return 0;
  }
  console.log(`  ✅ Got ${captions.segments.length} caption segments (${captions.source})`);

  // 2. Build candidates from transcript
  const rawCandidates = buildCandidatesFromTranscript(captions.segments);
  console.log(`  🧩 Built ${rawCandidates.length} candidates`);

  if (rawCandidates.length === 0) {
    console.log(`  ⚠️  No candidates generated, skipping`);
    return 0;
  }

  // 3. Download video for multimodal scoring (Gemini needs frames)
  let localVideoPath: string | null = null;
  let effectiveProvider = provider;
  if (provider === 'gemini') {
    console.log(`  ⬇️  Downloading video for multimodal scoring...`);
    try {
      localVideoPath = await downloadFeedVideoToTemp(youtubeUrl);
    } catch (err) {
      console.warn(`  ⚠️  Download failed: ${(err as Error).message}`);
      console.log(`  📄 Falling back to ollama (transcript-only) scoring`);
      effectiveProvider = 'ollama';
    }
  }

  // 4. Score with LLM + collect training data
  const trainingCollector = new TrainingCollector(TRAINING_SEED_USER_ID, jobId);
  const costTracker = new CostTracker(TRAINING_SEED_USER_ID, jobId);

  try {
    console.log(`  🤖 Scoring with ${effectiveProvider}...`);
    const scored = await scoreAndRankCandidatesLLM({
      s3Url: youtubeUrl,
      candidates: rawCandidates,
      topN: 20,
      targetPlatform: 'all',
      contentStyle: 'politics',
      saferClips: false,
      includeAudio: false,
      localVideoPath: localVideoPath ?? undefined,
      providerOverride: effectiveProvider,
      costTracker,
      trainingCollector,
    });

    // Mark top candidates as selected
    trainingCollector.markSelected(
      scored.slice(0, 5).map((c) => ({ tStartS: c.tStartS, tEndS: c.tEndS }))
    );

    console.log(
      `  ✅ Scored ${scored.length} candidates, collected ${trainingCollector.count} training examples`
    );

    // 5. Flush
    await trainingCollector.flush();
    await costTracker.flush();

    return trainingCollector.count;
  } finally {
    // Cleanup temp video
    if (localVideoPath && fs.existsSync(localVideoPath)) {
      fs.unlinkSync(localVideoPath);
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const channelsArg =
    args.find((a) => a.startsWith('--channels'))?.split('=')[1] ??
    args[args.indexOf('--channels') + 1] ??
    'all';
  const limitArg =
    args.find((a) => a.startsWith('--limit'))?.split('=')[1] ??
    args[args.indexOf('--limit') + 1] ??
    '1';
  const providerArg =
    args.find((a) => a.startsWith('--provider'))?.split('=')[1] ??
    args[args.indexOf('--provider') + 1] ??
    'gemini';

  const limit = parseInt(limitArg, 10);
  const provider = providerArg;

  if (provider === 'gemini' && !process.env.GOOGLE_API_KEY) {
    console.error('❌ GOOGLE_API_KEY is required for Gemini scoring');
    process.exit(1);
  }

  // Resolve channel list
  const channelKeys =
    channelsArg === 'all'
      ? Object.keys(CHANNELS)
      : channelsArg.split(',').filter((k) => CHANNELS[k]);

  if (channelKeys.length === 0) {
    console.error(`❌ No valid channels. Available: ${Object.keys(CHANNELS).join(', ')}`);
    process.exit(1);
  }

  console.log(`\n🎯 Training Data Seed`);
  console.log(`   Channels: ${channelKeys.join(', ')}`);
  console.log(`   Videos per channel: ${limit}`);
  console.log(`   Provider: ${provider}\n`);

  let totalExamples = 0;

  for (const key of channelKeys) {
    const channel = CHANNELS[key];
    console.log(`\n📺 ${channel.name}`);

    // Use yt-dlp to list recent videos
    const videos = await fetchChannelVideos(channel.url, limit);
    if (videos.length === 0) {
      console.log(`  ⚠️  No videos found, skipping`);
      continue;
    }
    console.log(`  📋 Found ${videos.length} videos`);

    for (let i = 0; i < videos.length; i++) {
      const { videoId, title } = videos[i];
      console.log(`\n  [${i + 1}/${videos.length}] ${title} (${videoId})`);

      try {
        const count = await processVideo(videoId, title, channel.name, provider);
        totalExamples += count;
      } catch (err) {
        console.error(`  ❌ Error processing ${videoId}: ${(err as Error).message}`);
      }
    }
  }

  console.log(`\n✅ Done! Collected ${totalExamples} total training examples.\n`);
}

main()
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  })
  .finally(async () => prisma.$disconnect());
