import { prisma } from './prisma';
import { gunzipSync } from 'zlib';
import type { Prisma } from '@prisma/client';

export type DatasetId = 'jobs_report' | 'nar_existing_home_sales' | 'redfin_national_housing';

type SeriesPoint = {
  date: string;
  value: number;
};

type SnapshotMetric = {
  label: string;
  value: string;
  mom?: string;
  yoy?: string;
};

export type DataDropSnapshot = {
  datasetId: DatasetId;
  datasetName: string;
  releaseDate: string;
  releaseKey: string;
  importanceScore: number;
  summary: string;
  whyImportant: string[];
  metrics: SnapshotMetric[];
  sourceUrls: string[];
  tags: string[];
  raw: Record<string, number | string | boolean | null>;
};

type PublicationAutomationTarget = {
  id: string;
  userId: string;
  name: string;
  datasetIds: DatasetId[];
  minImportanceScore: number;
  combinedPosts: boolean;
  maxPostsPerRun: number;
};

export type DataDropRunOptions = {
  publicationId?: string;
  dryRun?: boolean;
  skipDatabase?: boolean;
};

export type DataDropRunResult = {
  publicationsChecked: number;
  snapshotsFetched: number;
  draftsCreated: number;
};

export type DataSourceDescriptor = {
  id: DatasetId;
  datasetId: DatasetId;
  datasetName: string;
  name: string;
  details: string;
  sourceUrl: string;
  updateCadence: string;
};

type AutomationConfig = {
  enabled: boolean;
  datasets: DatasetId[];
  minImportanceScore: number;
  combinedPosts: boolean;
  maxPostsPerRun: number;
};

const FRED_SERIES_URL = 'https://fred.stlouisfed.org/graph/fredgraph.csv?id=';
const REDFIN_NATIONAL_URL =
  'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/us_national_market_tracker.tsv000.gz';
const REDFIN_DATA_CENTER_URL = 'https://www.redfin.com/news/data-center/';
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_DATASETS: DatasetId[] = [
  'jobs_report',
  'nar_existing_home_sales',
  'redfin_national_housing',
];

function parseNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const normalized = raw.replace(/^"|"$/g, '').trim();
  if (!normalized || normalized.toUpperCase() === 'NA' || normalized === '.') return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseQuotedTsvLine(line: string): string[] {
  return line.split('\t').map((part) => part.replace(/^"|"$/g, ''));
}

export function parseFredCsv(csvText: string): SeriesPoint[] {
  const lines = csvText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];

  const header = lines[0].split(',');
  if (header.length < 2) return [];

  const points: SeriesPoint[] = [];
  for (const line of lines.slice(1)) {
    const [dateRaw, valueRaw] = line.split(',');
    if (!dateRaw || !valueRaw) continue;
    const value = parseNumber(valueRaw);
    if (value === null) continue;
    points.push({ date: dateRaw.trim(), value });
  }

  return points.sort((a, b) => a.date.localeCompare(b.date));
}

function pctChange(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null;
  return ((current - previous) / Math.abs(previous)) * 100;
}

function pointChange(current: number, previous: number | null): number | null {
  if (previous === null) return null;
  return current - previous;
}

function yearAgoPoint(points: SeriesPoint[]): SeriesPoint | null {
  if (points.length < 13) return null;
  return points[points.length - 13] ?? null;
}

function latestPoint(points: SeriesPoint[]): SeriesPoint {
  const latest = points[points.length - 1];
  if (!latest) {
    throw new Error('Series has no numeric observations');
  }
  return latest;
}

function previousPoint(points: SeriesPoint[]): SeriesPoint | null {
  return points.length >= 2 ? points[points.length - 2] : null;
}

function monthYear(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return date;
  return new Intl.DateTimeFormat('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

function signed(value: number | null, fractionDigits = 1): string {
  if (value === null) return 'n/a';
  const formatted = Math.abs(value).toFixed(fractionDigits);
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

async function fetchText(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Polemicyst-DataDropWorker/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'Polemicyst-DataDropWorker/1.0',
      },
    });
    if (!response.ok) {
      throw new Error(`Request failed (${response.status}) for ${url}`);
    }
    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchFredSeries(seriesId: string): Promise<SeriesPoint[]> {
  const csvText = await fetchText(`${FRED_SERIES_URL}${encodeURIComponent(seriesId)}`);
  return parseFredCsv(csvText);
}

export async function fetchJobsSnapshot(): Promise<DataDropSnapshot> {
  const [payems, unrate] = await Promise.all([fetchFredSeries('PAYEMS'), fetchFredSeries('UNRATE')]);
  if (payems.length < 2 || unrate.length < 2) {
    throw new Error('Jobs report series are too short');
  }

  const payemsLatest = latestPoint(payems);
  const payemsPrevious = previousPoint(payems);
  const unrateLatest = latestPoint(unrate);
  const unratePrevious = previousPoint(unrate);
  const unrateYearAgo = yearAgoPoint(unrate);

  const payrollDeltaK = pointChange(payemsLatest.value, payemsPrevious?.value ?? null);
  const unemploymentDeltaPp = pointChange(unrateLatest.value, unratePrevious?.value ?? null);
  const unemploymentYoYPp = pointChange(unrateLatest.value, unrateYearAgo?.value ?? null);

  const importanceScore = Math.min(
    100,
    Math.min(60, (Math.abs(payrollDeltaK ?? 0) / 250) * 60) +
      Math.min(25, (Math.abs(unemploymentDeltaPp ?? 0) / 0.2) * 25) +
      Math.min(15, (Math.abs(unemploymentYoYPp ?? 0) / 0.6) * 15)
  );

  const whyImportant: string[] = [];
  if (Math.abs(payrollDeltaK ?? 0) >= 150) {
    whyImportant.push(`Payroll momentum moved by ${signed(payrollDeltaK, 0)}K jobs month-over-month.`);
  }
  if (Math.abs(unemploymentDeltaPp ?? 0) >= 0.2) {
    whyImportant.push(
      `Unemployment shifted ${signed(unemploymentDeltaPp, 1)} percentage points in one month.`
    );
  }
  if (Math.abs(unemploymentYoYPp ?? 0) >= 0.4) {
    whyImportant.push(
      `Unemployment is ${signed(unemploymentYoYPp, 1)} percentage points year-over-year.`
    );
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Labor metrics are steady, but still important for confirming trend direction.');
  }

  const releaseDate = [payemsLatest.date, unrateLatest.date].sort().at(-1) ?? payemsLatest.date;

  return {
    datasetId: 'jobs_report',
    datasetName: 'U.S. Jobs Report',
    releaseDate,
    releaseKey: `jobs_report:${releaseDate}`,
    importanceScore,
    summary: `Payrolls changed ${signed(payrollDeltaK, 0)}K and unemployment is ${unrateLatest.value.toFixed(
      1
    )}% (${signed(unemploymentDeltaPp, 1)} pp MoM).`,
    whyImportant,
    metrics: [
      {
        label: 'Nonfarm Payroll Change',
        value: payrollDeltaK === null ? 'n/a' : `${signed(payrollDeltaK, 0)}K`,
      },
      {
        label: 'Unemployment Rate',
        value: `${unrateLatest.value.toFixed(1)}%`,
        mom: `${signed(unemploymentDeltaPp, 1)} pp`,
        yoy: `${signed(unemploymentYoYPp, 1)} pp`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}PAYEMS`, `${FRED_SERIES_URL}UNRATE`],
    tags: ['jobs report', 'labor market', 'macro'],
    raw: {
      payrollLevelK: payemsLatest.value,
      payrollDeltaK,
      unemploymentRate: unrateLatest.value,
      unemploymentDeltaPp,
      unemploymentYoYPp,
    },
  };
}

export async function fetchNarSnapshot(): Promise<DataDropSnapshot> {
  const existingSales = await fetchFredSeries('EXHOSLUSM495S');
  if (existingSales.length < 2) {
    throw new Error('NAR series is too short');
  }

  const latest = latestPoint(existingSales);
  const previous = previousPoint(existingSales);
  const yearAgo = yearAgoPoint(existingSales);
  const momPct = pctChange(latest.value, previous?.value ?? null);
  const yoyPct = pctChange(latest.value, yearAgo?.value ?? null);

  const importanceScore = Math.min(100, Math.abs(momPct ?? 0) * 4 + Math.abs(yoyPct ?? 0) * 2);

  const whyImportant: string[] = [];
  if (Math.abs(momPct ?? 0) >= 2.5) {
    whyImportant.push(`Existing-home sales moved ${signed(momPct, 1)}% month-over-month.`);
  }
  if (Math.abs(yoyPct ?? 0) >= 5) {
    whyImportant.push(`Sales are ${signed(yoyPct, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Home sales are stable, useful for trend confirmation and inflection detection.');
  }

  return {
    datasetId: 'nar_existing_home_sales',
    datasetName: 'NAR Existing Home Sales (SAAR)',
    releaseDate: latest.date,
    releaseKey: `nar_existing_home_sales:${latest.date}`,
    importanceScore,
    summary: `Existing-home sales printed ${(latest.value / 1_000_000).toFixed(2)}M SAAR (${signed(
      momPct,
      1
    )}% MoM, ${signed(yoyPct, 1)}% YoY).`,
    whyImportant,
    metrics: [
      {
        label: 'Existing Home Sales (SAAR)',
        value: `${(latest.value / 1_000_000).toFixed(2)}M`,
        mom: `${signed(momPct, 1)}%`,
        yoy: `${signed(yoyPct, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}EXHOSLUSM495S`],
    tags: ['housing', 'nar', 'existing home sales'],
    raw: {
      value: latest.value,
      momPct,
      yoyPct,
    },
  };
}

function getColumnIndexMap(header: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  for (let i = 0; i < header.length; i += 1) {
    map[header[i]] = i;
  }
  return map;
}

export async function fetchRedfinSnapshot(): Promise<DataDropSnapshot> {
  const compressed = await fetchBuffer(REDFIN_NATIONAL_URL);
  const unzipped = gunzipSync(compressed).toString('utf8');
  const lines = unzipped.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) {
    throw new Error('Redfin dataset is empty');
  }

  const header = parseQuotedTsvLine(lines[0]);
  const columns = getColumnIndexMap(header);
  const required = [
    'REGION_TYPE',
    'PROPERTY_TYPE',
    'IS_SEASONALLY_ADJUSTED',
    'PERIOD_END',
    'MEDIAN_SALE_PRICE',
    'MEDIAN_SALE_PRICE_YOY',
    'INVENTORY_YOY',
    'MONTHS_OF_SUPPLY',
    'MONTHS_OF_SUPPLY_YOY',
  ];
  for (const col of required) {
    if (!(col in columns)) {
      throw new Error(`Redfin column missing: ${col}`);
    }
  }

  let latestRow: string[] | null = null;
  for (const line of lines.slice(1)) {
    const row = parseQuotedTsvLine(line);
    const regionType = row[columns.REGION_TYPE];
    const propertyType = row[columns.PROPERTY_TYPE];
    const isAdjusted = row[columns.IS_SEASONALLY_ADJUSTED];
    if (regionType !== 'national' || propertyType !== 'All Residential' || isAdjusted !== 'true') {
      continue;
    }

    if (!latestRow || row[columns.PERIOD_END] > latestRow[columns.PERIOD_END]) {
      latestRow = row;
    }
  }

  if (!latestRow) {
    throw new Error('Redfin latest national all-residential SA row not found');
  }

  const periodEnd = latestRow[columns.PERIOD_END];
  const medianSalePrice = parseNumber(latestRow[columns.MEDIAN_SALE_PRICE]) ?? 0;
  const medianSalePriceYoYRatio = parseNumber(latestRow[columns.MEDIAN_SALE_PRICE_YOY]);
  const inventoryYoYRatio = parseNumber(latestRow[columns.INVENTORY_YOY]);
  const monthsSupply = parseNumber(latestRow[columns.MONTHS_OF_SUPPLY]) ?? 0;
  const monthsSupplyYoYRatio = parseNumber(latestRow[columns.MONTHS_OF_SUPPLY_YOY]);

  const medianSalePriceYoY = (medianSalePriceYoYRatio ?? 0) * 100;
  const inventoryYoY = (inventoryYoYRatio ?? 0) * 100;
  const monthsSupplyYoY = (monthsSupplyYoYRatio ?? 0) * 100;

  const importanceScore = Math.min(
    100,
    Math.abs(medianSalePriceYoY) * 2 + Math.abs(inventoryYoY) * 1.2 + Math.abs(monthsSupplyYoY) * 1.1
  );

  const whyImportant: string[] = [];
  if (Math.abs(medianSalePriceYoY) >= 3) {
    whyImportant.push(`Median sale price is ${signed(medianSalePriceYoY, 1)}% year-over-year.`);
  }
  if (Math.abs(inventoryYoY) >= 8) {
    whyImportant.push(`Inventory is ${signed(inventoryYoY, 1)}% year-over-year.`);
  }
  if (Math.abs(monthsSupplyYoY) >= 8) {
    whyImportant.push(`Months of supply is ${signed(monthsSupplyYoY, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Housing supply and price changes remain a key read-through for affordability.');
  }

  return {
    datasetId: 'redfin_national_housing',
    datasetName: 'Redfin National Housing (All Residential, SA)',
    releaseDate: periodEnd,
    releaseKey: `redfin_national_housing:${periodEnd}`,
    importanceScore,
    summary: `Median sale price $${Math.round(medianSalePrice).toLocaleString()} (${signed(
      medianSalePriceYoY,
      1
    )}% YoY), inventory ${signed(inventoryYoY, 1)}% YoY.`,
    whyImportant,
    metrics: [
      {
        label: 'Median Sale Price',
        value: `$${Math.round(medianSalePrice).toLocaleString()}`,
        yoy: `${signed(medianSalePriceYoY, 1)}%`,
      },
      {
        label: 'Months of Supply',
        value: `${monthsSupply.toFixed(2)}`,
        yoy: `${signed(monthsSupplyYoY, 1)}%`,
      },
      {
        label: 'Inventory',
        value: 'Index in source table',
        yoy: `${signed(inventoryYoY, 1)}%`,
      },
    ],
    sourceUrls: [REDFIN_NATIONAL_URL, REDFIN_DATA_CENTER_URL],
    tags: ['housing', 'redfin', 'inventory'],
    raw: {
      medianSalePrice,
      medianSalePriceYoY,
      inventoryYoY,
      monthsSupply,
      monthsSupplyYoY,
      periodEnd,
    },
  };
}

const SNAPSHOT_FETCHERS: Record<DatasetId, () => Promise<DataDropSnapshot>> = {
  jobs_report: fetchJobsSnapshot,
  nar_existing_home_sales: fetchNarSnapshot,
  redfin_national_housing: fetchRedfinSnapshot,
};

const DATA_SOURCE_DESCRIPTORS: DataSourceDescriptor[] = [
  {
    id: 'jobs_report',
    datasetId: 'jobs_report',
    datasetName: 'U.S. Jobs Report',
    name: 'U.S. Jobs Report',
    details: 'BLS employment metrics via FRED series PAYEMS and UNRATE.',
    sourceUrl: 'https://fred.stlouisfed.org/',
    updateCadence: 'Monthly (typically first Friday)',
  },
  {
    id: 'nar_existing_home_sales',
    datasetId: 'nar_existing_home_sales',
    datasetName: 'NAR Existing Home Sales',
    name: 'NAR Existing Home Sales',
    details: 'Existing-home sales SAAR via FRED series EXHOSLUSM495S.',
    sourceUrl: 'https://fred.stlouisfed.org/series/EXHOSLUSM495S',
    updateCadence: 'Monthly (mid-month release)',
  },
  {
    id: 'redfin_national_housing',
    datasetId: 'redfin_national_housing',
    datasetName: 'Redfin National Housing',
    name: 'Redfin National Housing',
    details: 'All Residential national market tracker dataset from Redfin Data Center.',
    sourceUrl:
      'https://redfin-public-data.s3.us-west-2.amazonaws.com/redfin_market_tracker/us_national_market_tracker.tsv000.gz',
    updateCadence: 'Monthly (third full week)',
  },
];

export function getSupportedDataSources(): DataSourceDescriptor[] {
  return [...DATA_SOURCE_DESCRIPTORS];
}

function configFromJson(configJson: unknown): AutomationConfig {
  const defaults: AutomationConfig = {
    enabled: false,
    datasets: [...DEFAULT_DATASETS],
    minImportanceScore: 35,
    combinedPosts: true,
    maxPostsPerRun: 3,
  };

  if (!configJson || typeof configJson !== 'object') {
    return defaults;
  }

  const top = configJson as Record<string, unknown>;
  const raw = top.dataDropAutomation;
  if (!raw || typeof raw !== 'object') {
    return defaults;
  }

  const automation = raw as Record<string, unknown>;
  const datasetCandidates = Array.isArray(automation.datasets)
    ? automation.datasets.filter(
        (value): value is DatasetId =>
          value === 'jobs_report' ||
          value === 'nar_existing_home_sales' ||
          value === 'redfin_national_housing'
      )
    : [];

  return {
    enabled: automation.enabled === true,
    datasets: datasetCandidates.length > 0 ? datasetCandidates : defaults.datasets,
    minImportanceScore:
      typeof automation.minImportanceScore === 'number'
        ? automation.minImportanceScore
        : defaults.minImportanceScore,
    combinedPosts:
      typeof automation.combinedPosts === 'boolean' ? automation.combinedPosts : defaults.combinedPosts,
    maxPostsPerRun:
      typeof automation.maxPostsPerRun === 'number' ? automation.maxPostsPerRun : defaults.maxPostsPerRun,
  };
}

async function resolveAutomationTargets(
  publicationIdOverride?: string
): Promise<PublicationAutomationTarget[]> {
  const allPublications = await prisma.publication.findMany({
    select: {
      id: true,
      userId: true,
      name: true,
      configJson: true,
    },
  });

  const forcedPublicationId = publicationIdOverride || process.env.DATA_DROP_AUTOMATION_PUBLICATION_ID;

  const targets: PublicationAutomationTarget[] = [];
  for (const publication of allPublications) {
    const config = configFromJson(publication.configJson);
    const isForced = forcedPublicationId ? forcedPublicationId === publication.id : false;
    if (!config.enabled && !isForced) continue;

    targets.push({
      id: publication.id,
      userId: publication.userId,
      name: publication.name,
      datasetIds: config.datasets,
      minImportanceScore: config.minImportanceScore,
      combinedPosts: config.combinedPosts,
      maxPostsPerRun: config.maxPostsPerRun,
    });
  }

  return targets;
}

function markdownForSingle(snapshot: DataDropSnapshot): string {
  const lines: string[] = [];
  lines.push(`## Key takeaway`);
  lines.push(snapshot.summary);
  lines.push('');
  lines.push('## What changed');
  lines.push('| Metric | Value | MoM | YoY |');
  lines.push('| --- | --- | --- | --- |');
  for (const metric of snapshot.metrics) {
    lines.push(
      `| ${metric.label} | ${metric.value} | ${metric.mom ?? 'n/a'} | ${metric.yoy ?? 'n/a'} |`
    );
  }
  lines.push('');
  lines.push('## Why this matters');
  for (const reason of snapshot.whyImportant) {
    lines.push(`- ${reason}`);
  }
  lines.push('');
  lines.push('## Conclusion');
  lines.push(
    'The latest release adds to the macro picture. Watch whether next month confirms this direction or reverses it.'
  );
  lines.push('');
  lines.push('## Sources');
  for (const source of snapshot.sourceUrls) {
    lines.push(`- ${source}`);
  }
  return lines.join('\n');
}

function markdownForCombined(snapshots: DataDropSnapshot[]): string {
  const lines: string[] = [];
  lines.push('## Multi-dataset pulse');
  lines.push(
    'This draft combines major macro and housing releases to highlight where signals are converging or diverging.'
  );
  lines.push('');
  for (const snapshot of snapshots) {
    lines.push(`### ${snapshot.datasetName}`);
    lines.push(`- ${snapshot.summary}`);
    for (const reason of snapshot.whyImportant) {
      lines.push(`- ${reason}`);
    }
    lines.push('');
  }
  lines.push('## Important conclusions');
  lines.push('- Cross-check labor strength versus housing demand and inventory dynamics.');
  lines.push('- Prioritize the indicators with the largest absolute month-over-month and year-over-year shifts.');
  lines.push('- Treat this as directional context and validate with the next release cycle.');
  lines.push('');
  lines.push('## Sources');
  const sources = Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.sourceUrls)));
  for (const source of sources) {
    lines.push(`- ${source}`);
  }
  return lines.join('\n');
}

function combinedReleaseKey(snapshots: DataDropSnapshot[]): string {
  return snapshots
    .slice()
    .sort((a, b) => a.datasetId.localeCompare(b.datasetId))
    .map((snapshot) => `${snapshot.datasetId}@${snapshot.releaseDate}`)
    .join('|');
}

async function articleExists(publicationId: string, sourceId: string): Promise<boolean> {
  const existing = await prisma.article.findFirst({
    where: {
      publicationId,
      sourceType: 'data_drop',
      sourceId,
    },
    select: { id: true },
  });
  return Boolean(existing);
}

function titleForSingle(snapshot: DataDropSnapshot): string {
  return `${snapshot.datasetName}: ${monthYear(snapshot.releaseDate)} Data Drop`;
}

function titleForCombined(snapshots: DataDropSnapshot[]): string {
  const latestDate = snapshots
    .map((snapshot) => snapshot.releaseDate)
    .sort()
    .at(-1);
  return `Macro Data Pulse: ${latestDate ? monthYear(latestDate) : 'Latest Releases'}`;
}

async function createSingleDraft(
  target: PublicationAutomationTarget,
  snapshot: DataDropSnapshot
): Promise<void> {
  const sourceContext: Prisma.InputJsonObject = {
    mode: 'single',
    dataset: snapshot.datasetId,
    releaseDate: snapshot.releaseDate,
    importanceScore: snapshot.importanceScore,
    raw: snapshot.raw as Prisma.InputJsonObject,
  };

  await prisma.article.create({
    data: {
      publicationId: target.id,
      userId: target.userId,
      title: titleForSingle(snapshot),
      subtitle: `Automated analysis for ${snapshot.datasetName}`,
      bodyMarkdown: markdownForSingle(snapshot),
      bodyHtml: null,
      sourceType: 'data_drop',
      sourceId: snapshot.releaseKey,
      sourceContext,
      generationModel: 'data-drop-automation-v1',
      status: 'review',
      tags: snapshot.tags,
    },
  });
}

async function createCombinedDraft(
  target: PublicationAutomationTarget,
  snapshots: DataDropSnapshot[]
): Promise<void> {
  const key = combinedReleaseKey(snapshots);
  const sourceContext: Prisma.InputJsonObject = {
    mode: 'combined',
    datasets: snapshots.map(
      (snapshot): Prisma.InputJsonObject => ({
        id: snapshot.datasetId,
        releaseDate: snapshot.releaseDate,
        importanceScore: snapshot.importanceScore,
        raw: snapshot.raw as Prisma.InputJsonObject,
      })
    ),
  };

  await prisma.article.create({
    data: {
      publicationId: target.id,
      userId: target.userId,
      title: titleForCombined(snapshots),
      subtitle: 'Automated synthesis across multiple data releases',
      bodyMarkdown: markdownForCombined(snapshots),
      bodyHtml: null,
      sourceType: 'data_drop',
      sourceId: `combined:${key}`,
      sourceContext,
      generationModel: 'data-drop-automation-v1',
      status: 'review',
      tags: Array.from(new Set(snapshots.flatMap((snapshot) => snapshot.tags))),
    },
  });
}

export async function runDataDropAutomation(
  options: DataDropRunOptions = {}
): Promise<DataDropRunResult> {
  const dryRun = options.dryRun === true;
  const skipDatabase = options.skipDatabase === true;
  const targets = skipDatabase
    ? []
    : await resolveAutomationTargets(options.publicationId).catch((error) => {
        console.error('[data-drop] Failed to load publication targets:', error);
        return [];
      });

  const datasetIdSet = new Set<DatasetId>();
  if (skipDatabase) {
    for (const id of DEFAULT_DATASETS) datasetIdSet.add(id);
  } else {
    for (const target of targets) {
      for (const datasetId of target.datasetIds) datasetIdSet.add(datasetId);
    }
  }

  const snapshotsByDataset = new Map<DatasetId, DataDropSnapshot>();
  for (const datasetId of datasetIdSet) {
    const fetcher = SNAPSHOT_FETCHERS[datasetId];
    if (!fetcher) continue;
    try {
      const snapshot = await fetcher();
      snapshotsByDataset.set(datasetId, snapshot);
      console.log(
        `[data-drop] ${datasetId} -> ${snapshot.releaseDate} (score=${snapshot.importanceScore.toFixed(1)})`
      );
    } catch (error) {
      console.error(`[data-drop] Failed fetching dataset ${datasetId}:`, error);
    }
  }

  if (skipDatabase) {
    for (const snapshot of snapshotsByDataset.values()) {
      console.log(`[data-drop] Dry-run snapshot: ${snapshot.datasetName}`);
      console.log(markdownForSingle(snapshot));
      console.log('---');
    }
    return {
      publicationsChecked: 0,
      snapshotsFetched: snapshotsByDataset.size,
      draftsCreated: 0,
    };
  }

  let draftsCreated = 0;
  for (const target of targets) {
    const candidateSnapshots = target.datasetIds
      .map((datasetId) => snapshotsByDataset.get(datasetId))
      .filter((snapshot): snapshot is DataDropSnapshot => Boolean(snapshot))
      .sort((a, b) => b.importanceScore - a.importanceScore);

    if (candidateSnapshots.length === 0) continue;

    let createdForTarget = 0;
    for (const snapshot of candidateSnapshots) {
      if (snapshot.importanceScore < target.minImportanceScore) continue;
      if (createdForTarget >= target.maxPostsPerRun) break;

      const exists = await articleExists(target.id, snapshot.releaseKey);
      if (exists) continue;

      if (dryRun) {
        console.log(
          `[data-drop] [dry-run] would create single draft for publication=${target.id} sourceId=${snapshot.releaseKey}`
        );
      } else {
        await createSingleDraft(target, snapshot);
        draftsCreated += 1;
        createdForTarget += 1;
        console.log(
          `[data-drop] Created single draft publication=${target.id} sourceId=${snapshot.releaseKey}`
        );
      }
    }

    if (!target.combinedPosts || candidateSnapshots.length < 2) continue;
    if (createdForTarget >= target.maxPostsPerRun) continue;

    const selectedForCombined = candidateSnapshots.filter(
      (snapshot) => snapshot.importanceScore >= target.minImportanceScore
    );
    if (selectedForCombined.length < 2) continue;

    const combinedKey = `combined:${combinedReleaseKey(selectedForCombined)}`;
    const combinedExists = await articleExists(target.id, combinedKey);
    if (combinedExists) continue;

    const combinedScore =
      selectedForCombined.reduce((sum, snapshot) => sum + snapshot.importanceScore, 0) /
      selectedForCombined.length;
    if (combinedScore < target.minImportanceScore) continue;

    if (dryRun) {
      console.log(
        `[data-drop] [dry-run] would create combined draft for publication=${target.id} sourceId=${combinedKey}`
      );
    } else {
      await createCombinedDraft(target, selectedForCombined);
      draftsCreated += 1;
      console.log(`[data-drop] Created combined draft publication=${target.id} sourceId=${combinedKey}`);
    }
  }

  return {
    publicationsChecked: targets.length,
    snapshotsFetched: snapshotsByDataset.size,
    draftsCreated,
  };
}
