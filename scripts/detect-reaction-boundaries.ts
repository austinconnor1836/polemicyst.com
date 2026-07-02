/**
 * Reaction Boundary Detector (CLI)
 *
 * Thin command-line wrapper over `shared/util/reaction-boundaries.ts` — the same detector
 * the web client calls at `POST /api/reaction-sessions/detect-boundaries`. Use it to
 * validate the scene-cut signal and tune thresholds on a real capture from the terminal.
 *
 * Given ONE long screen-capture in which a fixed on-screen region plays reference videos
 * back-to-back, it finds where each reference ends and the next begins and prints the
 * resulting reaction windows. Needs only `ffmpeg` + `ffprobe` on PATH — no DB, no env.
 *
 * Usage:
 *   npx tsx scripts/detect-reaction-boundaries.ts --input capture.mp4 --ref-rect 960:0:960:1080
 *   npx tsx scripts/detect-reaction-boundaries.ts -i capture.mp4 -r 960:0:960:1080 --threshold 0.35 --min-segment 8
 *   npx tsx scripts/detect-reaction-boundaries.ts -i capture.mp4 -r 960:0:960:1080 --blackdetect --json boundaries.json
 *
 * Options:
 *   --input, -i        Path to the capture video (required).
 *   --ref-rect, -r     Reference region crop as x:y:w:h (pixels). Omit to scan the full frame.
 *   --threshold, -t    Scene-change score in 0..1 that counts as a cut (default 0.40).
 *   --min-segment, -m  Minimum seconds between accepted cuts; smaller gaps are merged (default 8).
 *   --max-segment      Platform limit in seconds; windows longer than this are flagged (default 90).
 *   --blackdetect      Also run blackdetect over the region and fold black-frame starts in as cuts.
 *   --json <path>      Write the detected windows to a JSON file.
 */

import type { CropRect } from '../shared/util/cropDetect';
import {
  detectReactionBoundaries,
  DEFAULT_SCENE_THRESHOLD,
  DEFAULT_MIN_SEGMENT_S,
  DEFAULT_PLATFORM_LIMIT_S,
  type ReactionWindow,
} from '../shared/util/reaction-boundaries';

interface CliOptions {
  input: string;
  refRect: CropRect | null;
  threshold: number;
  minSegment: number;
  maxSegment: number;
  blackdetect: boolean;
  jsonPath: string | null;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    input: '',
    refRect: null,
    threshold: DEFAULT_SCENE_THRESHOLD,
    minSegment: DEFAULT_MIN_SEGMENT_S,
    maxSegment: DEFAULT_PLATFORM_LIMIT_S,
    blackdetect: false,
    jsonPath: null,
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${a}`);
      }
      return v;
    };
    switch (a) {
      case '--input':
      case '-i':
        opts.input = next();
        break;
      case '--ref-rect':
      case '-r':
        opts.refRect = parseRect(next());
        break;
      case '--threshold':
      case '-t':
        opts.threshold = Number(next());
        break;
      case '--min-segment':
      case '-m':
        opts.minSegment = Number(next());
        break;
      case '--max-segment':
        opts.maxSegment = Number(next());
        break;
      case '--blackdetect':
        opts.blackdetect = true;
        break;
      case '--json':
        opts.jsonPath = next();
        break;
      case '--help':
      case '-h':
        printHelpAndExit();
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }

  if (!opts.input) {
    throw new Error('Missing required --input <path>');
  }
  return opts;
}

function parseRect(s: string): CropRect {
  const parts = s.split(':').map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n) || n < 0)) {
    throw new Error(`--ref-rect must be x:y:w:h (e.g. 960:0:960:1080), got "${s}"`);
  }
  const [x, y, w, h] = parts;
  if (w <= 0 || h <= 0) {
    throw new Error('--ref-rect width and height must be positive');
  }
  return { x, y, w, h };
}

function printHelpAndExit(): never {
  console.log(
    'Detect reaction boundaries in a long capture.\n' +
      'Usage: npx tsx scripts/detect-reaction-boundaries.ts --input <file> [--ref-rect x:y:w:h]\n' +
      'See the file header for all options.'
  );
  process.exit(0);
}

function fmt(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

function printTable(windows: ReactionWindow[], maxSegment: number): void {
  console.log('');
  console.log(`Reaction windows (${windows.length}):`);
  console.log('  #   start      end        length    flag');
  console.log('  ──  ─────────  ─────────  ────────  ─────────────────');
  for (const w of windows) {
    const flag = w.overLimit ? `OVER ${maxSegment}s — needs sub-split` : '';
    console.log(
      `  ${String(w.index).padStart(2)}  ${fmt(w.startS).padStart(9)}  ${fmt(w.endS).padStart(9)}  ` +
        `${(w.durationS.toFixed(1) + 's').padStart(8)}  ${flag}`
    );
  }
  const over = windows.filter((w) => w.overLimit).length;
  console.log('');
  if (over > 0) {
    console.log(`  ${over} window(s) exceed the ${maxSegment}s limit (P5 handles these).`);
  }
  console.log('  If windows look wrong: raise/lower --threshold, or raise --min-segment.');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  console.log(`Input:      ${opts.input}`);
  console.log(
    `Ref rect:   ${opts.refRect ? `${opts.refRect.x}:${opts.refRect.y}:${opts.refRect.w}:${opts.refRect.h}` : 'full frame'}`
  );
  console.log(
    `Threshold:  ${opts.threshold}   Min segment: ${opts.minSegment}s   Limit: ${opts.maxSegment}s`
  );
  console.log('Detecting reaction boundaries…');

  const result = await detectReactionBoundaries(opts.input, {
    refRect: opts.refRect,
    threshold: opts.threshold,
    minSegmentS: opts.minSegment,
    maxSegmentS: opts.maxSegment,
    useBlackDetect: opts.blackdetect,
  });

  console.log(`Duration:   ${result.durationS.toFixed(1)}s (${fmt(result.durationS)})`);
  console.log(`Raw cuts:   ${result.rawCutCount} above threshold.`);
  printTable(result.windows, opts.maxSegment);

  if (opts.jsonPath) {
    const fs = await import('fs');
    const payload = {
      input: opts.input,
      durationS: result.durationS,
      refRect: result.refRect,
      params: {
        threshold: result.threshold,
        minSegment: result.minSegmentS,
        maxSegment: result.maxSegmentS,
      },
      boundaries: result.windows.map((w) => ({
        startS: w.startS,
        endS: w.endS,
        overLimit: w.overLimit,
      })),
    };
    fs.writeFileSync(opts.jsonPath, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${result.windows.length} windows → ${opts.jsonPath}`);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
