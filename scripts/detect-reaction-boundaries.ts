/**
 * Reaction Boundary Detector (prototype)
 *
 * Given ONE long screen-capture in which a fixed on-screen region plays reference
 * videos back-to-back, find where each reference ends and the next begins — i.e. the
 * boundaries that split the recording into one reaction per reference.
 *
 * Signal: FFmpeg scene-change detection over ONLY the reference rectangle. When a new
 * reference video starts, that region has a hard visual discontinuity. A minimum-segment
 * gate suppresses cuts *inside* a single reference; optional blackdetect corroborates
 * fades between clips.
 *
 * This is a standalone de-risking tool for `specs/reaction-capture-splitter` — it touches
 * no app code, DB, or env. It only needs `ffmpeg` + `ffprobe` on PATH. Validate the signal
 * on a real capture and tune the thresholds before any of the pipeline is wired up.
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

import { spawn } from 'child_process';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Options {
  input: string;
  refRect: Rect | null;
  threshold: number;
  minSegment: number;
  maxSegment: number;
  blackdetect: boolean;
  jsonPath: string | null;
}

interface Segment {
  index: number;
  startS: number;
  endS: number;
  durationS: number;
  overLimit: boolean;
}

function parseArgs(argv: string[]): Options {
  const opts: Options = {
    input: '',
    refRect: null,
    threshold: 0.4,
    minSegment: 8,
    maxSegment: 90,
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
  if (!Number.isFinite(opts.threshold) || opts.threshold <= 0 || opts.threshold >= 1) {
    throw new Error('--threshold must be a number in (0, 1)');
  }
  if (!Number.isFinite(opts.minSegment) || opts.minSegment < 0) {
    throw new Error('--min-segment must be a non-negative number');
  }
  return opts;
}

function parseRect(s: string): Rect {
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
  // The JSDoc header is the canonical help; print a short pointer.
  console.log(
    'Detect reaction boundaries in a long capture.\n' +
      'Usage: npx tsx scripts/detect-reaction-boundaries.ts --input <file> [--ref-rect x:y:w:h]\n' +
      'See the file header for all options.'
  );
  process.exit(0);
}

/** Run a command, resolving with the combined stderr (ffmpeg writes diagnostics there). */
function runCapture(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args);
    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => (stdout += d.toString()));
    proc.stderr.on('data', (d) => (stderr += d.toString()));
    proc.on('error', (err) => {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        reject(new Error(`\`${cmd}\` not found on PATH. Install FFmpeg and retry.`));
      } else {
        reject(err);
      }
    });
    proc.on('close', (code) => {
      // ffprobe uses stdout; ffmpeg diagnostics land on stderr. Non-zero exit with a
      // -f null sink is unusual, but surface it rather than silently returning nothing.
      if (code !== 0 && !stderr && !stdout) {
        reject(new Error(`${cmd} exited ${code} with no output`));
      } else {
        resolve(stdout + stderr);
      }
    });
  });
}

async function probeDuration(input: string): Promise<number> {
  const out = await runCapture('ffprobe', [
    '-v',
    'error',
    '-show_entries',
    'format=duration',
    '-of',
    'default=nw=1:nk=1',
    input,
  ]);
  const dur = parseFloat(out.trim());
  if (!Number.isFinite(dur) || dur <= 0) {
    throw new Error(`Could not read duration from "${input}" (ffprobe returned "${out.trim()}")`);
  }
  return dur;
}

function cropPrefix(rect: Rect | null): string {
  return rect ? `crop=${rect.w}:${rect.h}:${rect.x}:${rect.y},` : '';
}

/** Scene-change timestamps (seconds) within the (optionally cropped) region. */
async function detectSceneCuts(opts: Options): Promise<number[]> {
  const vf = `${cropPrefix(opts.refRect)}select='gt(scene,${opts.threshold})',showinfo`;
  const out = await runCapture('ffmpeg', [
    '-nostats',
    '-i',
    opts.input,
    '-vf',
    vf,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  // showinfo prints one line per selected (i.e. scene-cut) frame, each carrying pts_time.
  const cuts: number[] = [];
  const re = /pts_time:([0-9]+\.?[0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    cuts.push(parseFloat(m[1]));
  }
  return cuts;
}

/** black_start timestamps (seconds) — fades/gaps between clips corroborate boundaries. */
async function detectBlackStarts(opts: Options): Promise<number[]> {
  const vf = `${cropPrefix(opts.refRect)}blackdetect=d=0.10:pic_th=0.98`;
  const out = await runCapture('ffmpeg', [
    '-nostats',
    '-i',
    opts.input,
    '-vf',
    vf,
    '-an',
    '-f',
    'null',
    '-',
  ]);
  const starts: number[] = [];
  const re = /black_start:([0-9]+\.?[0-9]*)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(out)) !== null) {
    starts.push(parseFloat(m[1]));
  }
  return starts;
}

/**
 * Turn raw cut timestamps into segment windows across [0, duration].
 * Cuts within `minSegment` of the previous accepted cut (or of 0) are dropped, so a
 * reference that cuts scenes internally doesn't over-split. A trailing sliver shorter
 * than `minSegment` is merged back into the previous window.
 */
function buildSegments(rawCuts: number[], duration: number, opts: Options): Segment[] {
  const sorted = [...new Set(rawCuts)].sort((a, b) => a - b).filter((t) => t > 0 && t < duration);

  const accepted: number[] = [];
  let last = 0;
  for (const t of sorted) {
    if (t - last >= opts.minSegment) {
      accepted.push(t);
      last = t;
    }
  }

  const bounds = [0, ...accepted, duration];
  const segments: Segment[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    segments.push({
      index: 0,
      startS: bounds[i],
      endS: bounds[i + 1],
      durationS: bounds[i + 1] - bounds[i],
      overLimit: false,
    });
  }

  // Merge a too-short trailing segment into its predecessor.
  if (segments.length >= 2) {
    const tail = segments[segments.length - 1];
    if (tail.durationS < opts.minSegment) {
      const prev = segments[segments.length - 2];
      prev.endS = tail.endS;
      prev.durationS = prev.endS - prev.startS;
      segments.pop();
    }
  }

  return segments.map((s, i) => ({
    ...s,
    index: i + 1,
    overLimit: s.durationS > opts.maxSegment,
  }));
}

function fmt(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

function printTable(segments: Segment[], opts: Options): void {
  console.log('');
  console.log(`Reaction windows (${segments.length}):`);
  console.log('  #   start      end        length    flag');
  console.log('  ──  ─────────  ─────────  ────────  ─────────────────');
  for (const s of segments) {
    const flag = s.overLimit ? `OVER ${opts.maxSegment}s — needs sub-split` : '';
    console.log(
      `  ${String(s.index).padStart(2)}  ${fmt(s.startS).padStart(9)}  ${fmt(s.endS).padStart(9)}  ` +
        `${(s.durationS.toFixed(1) + 's').padStart(8)}  ${flag}`
    );
  }
  const over = segments.filter((s) => s.overLimit).length;
  console.log('');
  if (over > 0) {
    console.log(`  ${over} window(s) exceed the ${opts.maxSegment}s limit (P5 handles these).`);
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

  const duration = await probeDuration(opts.input);
  console.log(`Duration:   ${duration.toFixed(1)}s (${fmt(duration)})`);

  console.log('Detecting scene cuts in the reference region…');
  const sceneCuts = await detectSceneCuts(opts);
  console.log(`  ${sceneCuts.length} raw scene cut(s) above threshold.`);

  let allCuts = sceneCuts;
  if (opts.blackdetect) {
    console.log('Running blackdetect…');
    const black = await detectBlackStarts(opts);
    console.log(`  ${black.length} black-frame start(s).`);
    allCuts = [...sceneCuts, ...black];
  }

  const segments = buildSegments(allCuts, duration, opts);
  printTable(segments, opts);

  if (opts.jsonPath) {
    const fs = await import('fs');
    const payload = {
      input: opts.input,
      durationS: duration,
      refRect: opts.refRect,
      params: {
        threshold: opts.threshold,
        minSegment: opts.minSegment,
        maxSegment: opts.maxSegment,
      },
      boundaries: segments.map((s) => ({
        startS: Number(s.startS.toFixed(3)),
        endS: Number(s.endS.toFixed(3)),
        overLimit: s.overLimit,
      })),
    };
    fs.writeFileSync(opts.jsonPath, JSON.stringify(payload, null, 2));
    console.log(`\nWrote ${segments.length} windows → ${opts.jsonPath}`);
  }
}

main().catch((err) => {
  console.error(`\nError: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
