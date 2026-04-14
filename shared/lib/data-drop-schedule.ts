import type { DatasetId } from './data-drop-automation';

type MonthlyScheduleDefinition = {
  datasetId: DatasetId;
  datasetName: string;
  resolveMonthlyReleaseUtc: (year: number, monthIndex: number) => Date;
};

export type DataDropReleaseWindow = {
  datasetId: DatasetId;
  datasetName: string;
  scheduledAt: Date;
};

export type DataDropCadence = {
  mode: 'baseline' | 'release-window';
  intervalMs: number;
  activeWindows: DataDropReleaseWindow[];
};

export type DataDropSchedulePreview = {
  cadence: DataDropCadence;
  upcomingReleases: DataDropReleaseWindow[];
  baselineIntervalMs: number;
  windowIntervalMs: number;
  windowLeadMinutes: number;
  windowLagMinutes: number;
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
    Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), base.getUTCDate(), hours, minutes, 0, 0)
  );
}

const MONTHLY_RELEASE_SCHEDULES: MonthlyScheduleDefinition[] = [
  {
    datasetId: 'jobs_report',
    datasetName: 'U.S. Jobs Report',
    // Typical BLS release: first Friday around 08:30 ET.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 1), 13, 30),
  },
  {
    datasetId: 'nar_existing_home_sales',
    datasetName: 'NAR Existing Home Sales',
    // NAR releases usually land around mid-month.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      new Date(Date.UTC(year, monthIndex, 20, 14, 0, 0, 0)),
  },
  {
    datasetId: 'redfin_national_housing',
    datasetName: 'Redfin Monthly Housing',
    // Redfin monthly market tracker data usually updates in the third full week Friday.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 3), 15, 0),
  },
  {
    datasetId: 'gallup_polls',
    datasetName: 'Gallup Polls',
    // Gallup publishes polls on a rolling cadence; use second Tuesday as acceleration anchor.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 2, 2), 13, 0),
  },
  {
    datasetId: 'inflation_cpi_core',
    datasetName: 'U.S. CPI & Core CPI',
    // CPI typically releases around mid-month.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      new Date(Date.UTC(year, monthIndex, 13, 13, 30, 0, 0)),
  },
  {
    datasetId: 'jobless_claims_weekly',
    datasetName: 'Initial Jobless Claims',
    // Weekly claims are usually released Thursday morning ET.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 4, 1), 13, 30),
  },
  {
    datasetId: 'retail_sales_advance',
    datasetName: 'U.S. Retail Sales',
    // Retail sales commonly land around mid-month.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      new Date(Date.UTC(year, monthIndex, 15, 13, 30, 0, 0)),
  },
  {
    datasetId: 'housing_starts_permits',
    datasetName: 'Housing Starts & Permits',
    // Housing starts/permits usually release around middle of month.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      new Date(Date.UTC(year, monthIndex, 18, 13, 30, 0, 0)),
  },
  {
    datasetId: 'yield_curve_spread',
    datasetName: 'Yield Curve Spread',
    // Treasury series are updated daily; use first business day as anchor.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 1, 1), 21, 0),
  },
  {
    datasetId: 'consumer_sentiment',
    datasetName: 'Consumer Sentiment',
    // University of Michigan preliminary sentiment usually lands early month Friday.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 2), 14, 0),
  },
  {
    datasetId: 'gallup_economy',
    datasetName: 'Gallup Economy',
    // RSS/rolling updates; use weekly Friday anchor.
    resolveMonthlyReleaseUtc: (year, monthIndex) =>
      withUtcTime(nthWeekdayOfMonthUtc(year, monthIndex, 5, 1), 13, 0),
  },
];

function computeScheduledReleases(now: Date): DataDropReleaseWindow[] {
  const schedules: DataDropReleaseWindow[] = [];
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

export function resolveDataDropCadence(now: Date = new Date()): DataDropCadence {
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

export function describeActiveWindows(cadence: DataDropCadence): string {
  return cadence.activeWindows
    .map((window) => `${window.datasetId}@${window.scheduledAt.toISOString()}`)
    .join(', ');
}

export function getDataDropSchedulePreview(now: Date = new Date()): DataDropSchedulePreview {
  const cadence = resolveDataDropCadence(now);
  const dayMs = 24 * MS_PER_HOUR;
  const upcomingReleases = computeScheduledReleases(now)
    .filter((release) => release.scheduledAt.getTime() >= now.getTime() - dayMs)
    .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())
    .slice(0, 6);

  return {
    cadence,
    upcomingReleases,
    baselineIntervalMs: BASELINE_INTERVAL_MS,
    windowIntervalMs: WINDOW_INTERVAL_MS,
    windowLeadMinutes: WINDOW_LEAD_MINUTES,
    windowLagMinutes: WINDOW_LAG_MINUTES,
  };
}
