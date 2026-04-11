import { runDataDropAutomation } from '@shared/lib/data-drop-automation';
import type { DatasetId } from '@shared/lib/data-drop-automation';

type ReleaseWindow = {
  datasetId: DatasetId;
  datasetName: string;
  scheduledAt: Date;
};

type AdaptiveCadence = {
  mode: 'baseline' | 'release-window';
  intervalMs: number;
  activeWindows: ReleaseWindow[];
};

type MonthlyScheduleDefinition = {
  datasetId: DatasetId;
  datasetName: string;
  resolveMonthlyReleaseUtc: (year: number, monthIndex: number) => Date;
};

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

const BASELINE_INTERVAL_MS = parsePositiveInt(
  process.env.DATA_DROP_BASELINE_INTERVAL_MS,
  6 * MS_PER_HOUR
);
const WINDOW_INTERVAL_MS = parsePositiveInt(
  process.env.DATA_DROP_WINDOW_INTERVAL_MS,
  parsePositiveInt(process.env.DATA_DROP_POLL_INTERVAL_MS, 15 * MS_PER_MINUTE)
);
const WINDOW_LEAD_MINUTES = parsePositiveInt(process.env.DATA_DROP_WINDOW_LEAD_MINUTES, 120);
const WINDOW_LAG_MINUTES = parsePositiveInt(process.env.DATA_DROP_WINDOW_LAG_MINUTES, 240);

function nthWeekdayOfMonthUtc(
  year: number,
  monthIndex: number,
  weekday: number,
  nth: number
): Date {
  const firstDay = new Date(Date.UTC(year, monthIndex, 1, 0, 0, 0, 0));
  const firstWeekdayOffset = (weekday - firstDay.getUTCDay() + 7) % 7;
  const dayOfMonth = 1 + firstWeekdayOffset + (nth - 1) * 7;
  return new Date(Date.UTC(year, monthIndex, dayOfMonth, 0, 0, 0, 0));
}

function withUtcTime(base: Date, hours: number, minutes: number): Date {
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate(),
      hours,
      minutes,
      0,
      0
    )
  );
}

const MONTHLY_RELEASE_SCHEDULES: MonthlyScheduleDefinition[] = [
  {
    datasetId: 'jobs_report',
    datasetName: 'U.S. Jobs Report',
    // Typical BLS release: first Friday around 08:30 ET.
    // Using 13:30 UTC as a stable anchor for release-window acceleration.
    resolveMonthlyReleaseUtc: (year, monthIndex) => withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 1), 13, 30),
  },
  {
    datasetId: 'nar_existing_home_sales',
    datasetName: 'NAR Existing Home Sales',
    // NAR releases usually land around mid-month. Use the 20th at 14:00 UTC as the window anchor.
    resolveMonthlyReleaseUtc: (year, monthIndex) => new Date(Date.UTC(year, monthIndex, 20, 14, 0, 0, 0)),
  },
  {
    datasetId: 'redfin_national_housing',
    datasetName: 'Redfin Monthly Housing',
    // Redfin monthly market tracker data typically updates during the third full week Friday.
    resolveMonthlyReleaseUtc: (year, monthIndex) => withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 3), 15, 0),
  },
];

function computeScheduledReleases(now: Date): ReleaseWindow[] {
  const schedules: ReleaseWindow[] = [];
  const baseYear = now.getUTCFullYear();
  const baseMonth = now.getUTCMonth();

  for (const monthOffset of [-1, 0, 1]) {
    const yearMonth = new Date(Date.UTC(baseYear, baseMonth + monthOffset, 1, 0, 0, 0, 0));
    const year = yearMonth.getUTCFullYear();
    const monthIndex = yearMonth.getUTCMonth();
    for (const schedule of MONTHLY_RELEASE_SCHEDULES) {
      schedules.push({
        datasetId: schedule.datasetId,
        datasetName: schedule.datasetName,
        scheduledAt: schedule.resolveMonthlyReleaseUtc(year, monthIndex),
      });
    }
  }

  return schedules;
}

export function resolveDataDropCadence(now: Date = new Date()): AdaptiveCadence {
  const leadMs = WINDOW_LEAD_MINUTES * MS_PER_MINUTE;
  const lagMs = WINDOW_LAG_MINUTES * MS_PER_MINUTE;
  const releases = computeScheduledReleases(now);

  const activeWindows = releases.filter((release) => {
    const releaseTs = release.scheduledAt.getTime();
    const nowTs = now.getTime();
    return nowTs >= releaseTs - leadMs && nowTs <= releaseTs + lagMs;
  });

  if (activeWindows.length > 0) {
    return {
      mode: 'release-window',
      intervalMs: WINDOW_INTERVAL_MS,
      activeWindows,
    };
  }

  return {
    mode: 'baseline',
    intervalMs: BASELINE_INTERVAL_MS,
    activeWindows: [],
  };
}

export function describeActiveWindows(cadence: AdaptiveCadence): string {
  return cadence.activeWindows
    .map((window) => `${window.datasetId}@${window.scheduledAt.toISOString()}`)
    .join(', ');
}

export async function pollDataDrops() {
  const result = await runDataDropAutomation();
  console.log(
    `[data-drop] run complete publications=${result.publicationsChecked} snapshots=${result.snapshotsFetched} drafts=${result.draftsCreated}`
  );
}

let dataDropTimer: NodeJS.Timeout | null = null;

export function startDataDropPolling() {
  if (dataDropTimer) {
    console.log('[data-drop] scheduler already running, skipping duplicate start');
    return;
  }

  const runLoop = async () => {
    const cadence = resolveDataDropCadence();
    const windows = describeActiveWindows(cadence);
    console.log(
      `[data-drop] scheduler mode=${cadence.mode} intervalMs=${cadence.intervalMs}${
        windows ? ` windows=${windows}` : ''
      }`
    );

    try {
      await pollDataDrops();
    } catch (error) {
      console.error('[data-drop] scheduled run failed:', error);
    } finally {
      dataDropTimer = setTimeout(runLoop, cadence.intervalMs);
    }
  };

  void runLoop();
}

async function runFromCli() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has('--dry-run');
  const skipDatabase = args.has('--skip-db');
  const publicationArg = process.argv.find((arg) => arg.startsWith('--publication='));
  const publicationId = publicationArg ? publicationArg.split('=')[1] : undefined;

  const result = await runDataDropAutomation({
    dryRun,
    skipDatabase,
    publicationId,
  });

  console.log(
    `[data-drop] CLI result publications=${result.publicationsChecked} snapshots=${result.snapshotsFetched} drafts=${result.draftsCreated}`
  );
}

if (require.main === module) {
  runFromCli().catch((error) => {
    console.error('[data-drop] CLI run failed:', error);
    process.exit(1);
  });
}
