import { prisma } from './prisma';
import { gunzipSync } from 'zlib';
import type { Prisma } from '@prisma/client';

export type DatasetId =
  | 'jobs_report'
  | 'cpi_inflation'
  | 'jobless_claims'
  | 'retail_sales'
  | 'housing_starts'
  | 'building_permits'
  | 'yield_curve_spread'
  | 'consumer_sentiment'
  | 'nar_existing_home_sales'
  | 'redfin_national_housing'
  | 'gallup_polls'
  | 'gallup_economy';

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
const GALLUP_POLITICS_RSS_URL = 'https://news.gallup.com/topic/government+and+politics.rss';
const GALLUP_ECONOMY_RSS_URL = 'https://news.gallup.com/topic/economy.rss';
const FETCH_TIMEOUT_MS = 20_000;
const DEFAULT_DATASETS: DatasetId[] = [
  'jobs_report',
  'cpi_inflation',
  'jobless_claims',
  'retail_sales',
  'housing_starts',
  'building_permits',
  'yield_curve_spread',
  'consumer_sentiment',
  'nar_existing_home_sales',
  'redfin_national_housing',
  'gallup_polls',
  'gallup_economy',
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

function parseRfc822Date(raw: string): Date | null {
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function decodeXmlEntities(input: string): string {
  return input
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function stripCdata(raw: string): string {
  const cdataMatch = raw.match(/^<!\[CDATA\[([\s\S]*)\]\]>$/);
  return cdataMatch ? cdataMatch[1] : raw;
}

function parseXmlTag(section: string, tag: string): string | null {
  const pattern = new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'i');
  const match = section.match(pattern);
  if (!match || !match[1]) return null;
  const value = stripCdata(match[1]).trim();
  return decodeXmlEntities(value);
}

type RssItem = {
  title: string;
  description: string;
  link: string;
  pubDate: string;
};

export function parseGallupRss(xmlText: string): RssItem[] {
  const items: RssItem[] = [];
  const matches = xmlText.matchAll(/<item>([\s\S]*?)<\/item>/gi);
  for (const match of matches) {
    const section = match[1];
    if (!section) continue;

    const title = parseXmlTag(section, 'title');
    const description = parseXmlTag(section, 'description');
    const link = parseXmlTag(section, 'link');
    const pubDate = parseXmlTag(section, 'pubDate');

    if (!title || !description || !link || !pubDate) continue;
    items.push({ title, description, link, pubDate });
  }

  return items;
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
  const [payems, unrate] = await Promise.all([
    fetchFredSeries('PAYEMS'),
    fetchFredSeries('UNRATE'),
  ]);
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
    whyImportant.push(
      `Payroll momentum moved by ${signed(payrollDeltaK, 0)}K jobs month-over-month.`
    );
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
    whyImportant.push(
      'Labor metrics are steady, but still important for confirming trend direction.'
    );
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

export async function fetchCpiInflationSnapshot(): Promise<DataDropSnapshot> {
  const [headlineCpi, coreCpi] = await Promise.all([
    fetchFredSeries('CPIAUCSL'),
    fetchFredSeries('CPILFESL'),
  ]);
  if (headlineCpi.length < 13 || coreCpi.length < 13) {
    throw new Error('CPI series are too short');
  }

  const headlineLatest = latestPoint(headlineCpi);
  const headlinePrevious = previousPoint(headlineCpi);
  const headlineYearAgo = yearAgoPoint(headlineCpi);
  const coreLatest = latestPoint(coreCpi);
  const corePrevious = previousPoint(coreCpi);
  const coreYearAgo = yearAgoPoint(coreCpi);

  const headlineMom = pctChange(headlineLatest.value, headlinePrevious?.value ?? null);
  const headlineYoY = pctChange(headlineLatest.value, headlineYearAgo?.value ?? null);
  const coreMom = pctChange(coreLatest.value, corePrevious?.value ?? null);
  const coreYoY = pctChange(coreLatest.value, coreYearAgo?.value ?? null);

  const importanceScore = Math.min(
    100,
    Math.abs(headlineMom ?? 0) * 30 +
      Math.abs(coreMom ?? 0) * 35 +
      Math.abs(headlineYoY ?? 0) * 6 +
      Math.abs(coreYoY ?? 0) * 8
  );

  const whyImportant: string[] = [];
  if (Math.abs(coreMom ?? 0) >= 0.25) {
    whyImportant.push(`Core CPI changed ${signed(coreMom, 2)}% month-over-month.`);
  }
  if (Math.abs(headlineMom ?? 0) >= 0.3) {
    whyImportant.push(`Headline CPI moved ${signed(headlineMom, 2)}% month-over-month.`);
  }
  if (Math.abs(coreYoY ?? 0) >= 0.5) {
    whyImportant.push(`Core CPI is ${signed(coreYoY, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push(
      'Inflation remains a primary macro signal for rates and real-income pressure.'
    );
  }

  const releaseDate = [headlineLatest.date, coreLatest.date].sort().at(-1) ?? headlineLatest.date;
  return {
    datasetId: 'cpi_inflation',
    datasetName: 'U.S. CPI Inflation',
    releaseDate,
    releaseKey: `cpi_inflation:${releaseDate}`,
    importanceScore,
    summary: `CPI ${signed(headlineYoY, 1)}% YoY (${signed(headlineMom, 2)}% MoM); core ${signed(
      coreYoY,
      1
    )}% YoY (${signed(coreMom, 2)}% MoM).`,
    whyImportant,
    metrics: [
      {
        label: 'Headline CPI',
        value: `${headlineLatest.value.toFixed(2)}`,
        mom: `${signed(headlineMom, 2)}%`,
        yoy: `${signed(headlineYoY, 1)}%`,
      },
      {
        label: 'Core CPI',
        value: `${coreLatest.value.toFixed(2)}`,
        mom: `${signed(coreMom, 2)}%`,
        yoy: `${signed(coreYoY, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}CPIAUCSL`, `${FRED_SERIES_URL}CPILFESL`],
    tags: ['inflation', 'cpi', 'core inflation', 'macro'],
    raw: {
      headlineCpi: headlineLatest.value,
      coreCpi: coreLatest.value,
      headlineMomPct: headlineMom,
      headlineYoYPct: headlineYoY,
      coreMomPct: coreMom,
      coreYoYPct: coreYoY,
    },
  };
}

export async function fetchJoblessClaimsSnapshot(): Promise<DataDropSnapshot> {
  const [initialClaims, continuingClaims] = await Promise.all([
    fetchFredSeries('ICSA'),
    fetchFredSeries('CCSA'),
  ]);
  if (initialClaims.length < 2 || continuingClaims.length < 2) {
    throw new Error('Jobless claims series are too short');
  }

  const initialLatest = latestPoint(initialClaims);
  const initialPrevious = previousPoint(initialClaims);
  const continuingLatest = latestPoint(continuingClaims);
  const continuingPrevious = previousPoint(continuingClaims);

  const initialWoW = pctChange(initialLatest.value, initialPrevious?.value ?? null);
  const continuingWoW = pctChange(continuingLatest.value, continuingPrevious?.value ?? null);
  const initialDelta = pointChange(initialLatest.value, initialPrevious?.value ?? null);

  const importanceScore = Math.min(
    100,
    Math.abs(initialWoW ?? 0) * 8 +
      Math.abs(continuingWoW ?? 0) * 5 +
      Math.abs(initialDelta ?? 0) / 25_000
  );

  const whyImportant: string[] = [];
  if (Math.abs(initialWoW ?? 0) >= 5) {
    whyImportant.push(`Initial claims moved ${signed(initialWoW, 1)}% week-over-week.`);
  }
  if (Math.abs(continuingWoW ?? 0) >= 3) {
    whyImportant.push(`Continuing claims moved ${signed(continuingWoW, 1)}% week-over-week.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Claims are stable but remain a high-frequency labor stress indicator.');
  }

  const releaseDate =
    [initialLatest.date, continuingLatest.date].sort().at(-1) ?? initialLatest.date;
  return {
    datasetId: 'jobless_claims',
    datasetName: 'U.S. Jobless Claims',
    releaseDate,
    releaseKey: `jobless_claims:${releaseDate}`,
    importanceScore,
    summary: `Initial claims ${Math.round(initialLatest.value).toLocaleString()} (${signed(
      initialWoW,
      1
    )}% WoW), continuing claims ${Math.round(continuingLatest.value).toLocaleString()} (${signed(
      continuingWoW,
      1
    )}% WoW).`,
    whyImportant,
    metrics: [
      {
        label: 'Initial Claims',
        value: Math.round(initialLatest.value).toLocaleString(),
        mom: `${signed(initialWoW, 1)}% WoW`,
      },
      {
        label: 'Continuing Claims',
        value: Math.round(continuingLatest.value).toLocaleString(),
        mom: `${signed(continuingWoW, 1)}% WoW`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}ICSA`, `${FRED_SERIES_URL}CCSA`],
    tags: ['labor market', 'jobless claims', 'weekly data'],
    raw: {
      initialClaims: initialLatest.value,
      continuingClaims: continuingLatest.value,
      initialWoWPct: initialWoW,
      continuingWoWPct: continuingWoW,
      initialDelta,
    },
  };
}

export async function fetchRetailSalesSnapshot(): Promise<DataDropSnapshot> {
  const retailSales = await fetchFredSeries('RSAFS');
  if (retailSales.length < 13) {
    throw new Error('Retail sales series is too short');
  }

  const latest = latestPoint(retailSales);
  const previous = previousPoint(retailSales);
  const yearAgo = yearAgoPoint(retailSales);
  const momPct = pctChange(latest.value, previous?.value ?? null);
  const yoyPct = pctChange(latest.value, yearAgo?.value ?? null);

  const importanceScore = Math.min(100, Math.abs(momPct ?? 0) * 18 + Math.abs(yoyPct ?? 0) * 4);
  const whyImportant: string[] = [];
  if (Math.abs(momPct ?? 0) >= 1) {
    whyImportant.push(`Retail sales moved ${signed(momPct, 1)}% month-over-month.`);
  }
  if (Math.abs(yoyPct ?? 0) >= 3) {
    whyImportant.push(`Retail sales are ${signed(yoyPct, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Consumer demand is steady; monitor for inflections in spending momentum.');
  }

  return {
    datasetId: 'retail_sales',
    datasetName: 'U.S. Retail Sales',
    releaseDate: latest.date,
    releaseKey: `retail_sales:${latest.date}`,
    importanceScore,
    summary: `Retail sales ${signed(momPct, 1)}% MoM and ${signed(yoyPct, 1)}% YoY (${Math.round(
      latest.value
    ).toLocaleString()}).`,
    whyImportant,
    metrics: [
      {
        label: 'Retail Sales (Advance)',
        value: Math.round(latest.value).toLocaleString(),
        mom: `${signed(momPct, 1)}%`,
        yoy: `${signed(yoyPct, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}RSAFS`],
    tags: ['consumer spending', 'retail sales', 'macro'],
    raw: {
      value: latest.value,
      momPct,
      yoyPct,
    },
  };
}

export async function fetchHousingStartsSnapshot(): Promise<DataDropSnapshot> {
  const starts = await fetchFredSeries('HOUST');
  if (starts.length < 13) {
    throw new Error('Housing starts series is too short');
  }

  const latest = latestPoint(starts);
  const previous = previousPoint(starts);
  const yearAgo = yearAgoPoint(starts);
  const momPct = pctChange(latest.value, previous?.value ?? null);
  const yoyPct = pctChange(latest.value, yearAgo?.value ?? null);
  const importanceScore = Math.min(100, Math.abs(momPct ?? 0) * 12 + Math.abs(yoyPct ?? 0) * 5);

  const whyImportant: string[] = [];
  if (Math.abs(momPct ?? 0) >= 4) {
    whyImportant.push(`Housing starts shifted ${signed(momPct, 1)}% month-over-month.`);
  }
  if (Math.abs(yoyPct ?? 0) >= 7) {
    whyImportant.push(`Housing starts are ${signed(yoyPct, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push(
      'Starts are stable; still important for supply and construction trend checks.'
    );
  }

  return {
    datasetId: 'housing_starts',
    datasetName: 'U.S. Housing Starts',
    releaseDate: latest.date,
    releaseKey: `housing_starts:${latest.date}`,
    importanceScore,
    summary: `Housing starts ${signed(momPct, 1)}% MoM and ${signed(yoyPct, 1)}% YoY (${(
      latest.value / 1_000
    ).toFixed(2)}M SAAR).`,
    whyImportant,
    metrics: [
      {
        label: 'Housing Starts (SAAR)',
        value: `${(latest.value / 1_000).toFixed(2)}M`,
        mom: `${signed(momPct, 1)}%`,
        yoy: `${signed(yoyPct, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}HOUST`],
    tags: ['housing', 'housing starts', 'construction'],
    raw: {
      value: latest.value,
      momPct,
      yoyPct,
    },
  };
}

export async function fetchBuildingPermitsSnapshot(): Promise<DataDropSnapshot> {
  const permits = await fetchFredSeries('PERMIT');
  if (permits.length < 13) {
    throw new Error('Building permits series is too short');
  }

  const latest = latestPoint(permits);
  const previous = previousPoint(permits);
  const yearAgo = yearAgoPoint(permits);
  const momPct = pctChange(latest.value, previous?.value ?? null);
  const yoyPct = pctChange(latest.value, yearAgo?.value ?? null);
  const importanceScore = Math.min(100, Math.abs(momPct ?? 0) * 11 + Math.abs(yoyPct ?? 0) * 5);

  const whyImportant: string[] = [];
  if (Math.abs(momPct ?? 0) >= 3) {
    whyImportant.push(`Building permits moved ${signed(momPct, 1)}% month-over-month.`);
  }
  if (Math.abs(yoyPct ?? 0) >= 6) {
    whyImportant.push(`Building permits are ${signed(yoyPct, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Permits are steady; useful for forward-looking housing supply direction.');
  }

  return {
    datasetId: 'building_permits',
    datasetName: 'U.S. Building Permits',
    releaseDate: latest.date,
    releaseKey: `building_permits:${latest.date}`,
    importanceScore,
    summary: `Building permits ${signed(momPct, 1)}% MoM and ${signed(yoyPct, 1)}% YoY (${(
      latest.value / 1_000
    ).toFixed(2)}M SAAR).`,
    whyImportant,
    metrics: [
      {
        label: 'Building Permits (SAAR)',
        value: `${(latest.value / 1_000).toFixed(2)}M`,
        mom: `${signed(momPct, 1)}%`,
        yoy: `${signed(yoyPct, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}PERMIT`],
    tags: ['housing', 'building permits', 'construction'],
    raw: {
      value: latest.value,
      momPct,
      yoyPct,
    },
  };
}

export async function fetchYieldCurveSpreadSnapshot(): Promise<DataDropSnapshot> {
  const [tenYear, twoYear] = await Promise.all([fetchFredSeries('DGS10'), fetchFredSeries('DGS2')]);
  if (tenYear.length < 2 || twoYear.length < 2) {
    throw new Error('Yield curve series are too short');
  }

  const twoYearByDate = new Map(twoYear.map((point) => [point.date, point.value]));
  const aligned = tenYear
    .filter((point) => twoYearByDate.has(point.date))
    .map((point) => ({
      date: point.date,
      tenYearYield: point.value,
      twoYearYield: twoYearByDate.get(point.date) as number,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (aligned.length < 2) {
    throw new Error('Yield curve series do not have enough overlapping points');
  }

  const latest = aligned[aligned.length - 1];
  const previous = aligned[aligned.length - 2];
  const spread = latest.tenYearYield - latest.twoYearYield;
  const previousSpread = previous.tenYearYield - previous.twoYearYield;
  const spreadChange = spread - previousSpread;
  const importanceScore = Math.min(100, Math.abs(spread) * 30 + Math.abs(spreadChange) * 60);

  const whyImportant: string[] = [];
  if (spread < 0) {
    whyImportant.push(`The 10Y-2Y spread is inverted at ${signed(spread, 2)} pp.`);
  } else if (spread > 1.25) {
    whyImportant.push(`The 10Y-2Y spread is steep at ${signed(spread, 2)} pp.`);
  }
  if (Math.abs(spreadChange) >= 0.1) {
    whyImportant.push(`Spread changed ${signed(spreadChange, 2)} pp day-over-day.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push('Yield-curve slope remains a key macro/recession risk barometer.');
  }

  return {
    datasetId: 'yield_curve_spread',
    datasetName: 'U.S. Yield Curve (10Y-2Y)',
    releaseDate: latest.date,
    releaseKey: `yield_curve_spread:${latest.date}`,
    importanceScore,
    summary: `10Y yield ${latest.tenYearYield.toFixed(2)}%, 2Y ${latest.twoYearYield.toFixed(
      2
    )}%, spread ${signed(spread, 2)} pp (${signed(spreadChange, 2)} pp d/d).`,
    whyImportant,
    metrics: [
      {
        label: '10Y Treasury Yield',
        value: `${latest.tenYearYield.toFixed(2)}%`,
      },
      {
        label: '2Y Treasury Yield',
        value: `${latest.twoYearYield.toFixed(2)}%`,
      },
      {
        label: '10Y-2Y Spread',
        value: `${signed(spread, 2)} pp`,
        mom: `${signed(spreadChange, 2)} pp`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}DGS10`, `${FRED_SERIES_URL}DGS2`],
    tags: ['rates', 'yield curve', 'treasuries', 'recession risk'],
    raw: {
      tenYearYield: latest.tenYearYield,
      twoYearYield: latest.twoYearYield,
      spread,
      spreadChange,
    },
  };
}

export async function fetchConsumerSentimentSnapshot(): Promise<DataDropSnapshot> {
  const sentiment = await fetchFredSeries('UMCSENT');
  if (sentiment.length < 13) {
    throw new Error('Consumer sentiment series is too short');
  }

  const latest = latestPoint(sentiment);
  const previous = previousPoint(sentiment);
  const yearAgo = yearAgoPoint(sentiment);
  const momPct = pctChange(latest.value, previous?.value ?? null);
  const yoyPct = pctChange(latest.value, yearAgo?.value ?? null);
  const pointDelta = pointChange(latest.value, previous?.value ?? null);
  const importanceScore = Math.min(100, Math.abs(pointDelta ?? 0) * 6 + Math.abs(yoyPct ?? 0) * 2);

  const whyImportant: string[] = [];
  if (Math.abs(pointDelta ?? 0) >= 4) {
    whyImportant.push(
      `Consumer sentiment changed ${signed(pointDelta, 1)} points month-over-month.`
    );
  }
  if (Math.abs(yoyPct ?? 0) >= 8) {
    whyImportant.push(`Consumer sentiment is ${signed(yoyPct, 1)}% year-over-year.`);
  }
  if (whyImportant.length === 0) {
    whyImportant.push(
      'Sentiment is steady; still useful for consumption and confidence trend direction.'
    );
  }

  return {
    datasetId: 'consumer_sentiment',
    datasetName: 'U.S. Consumer Sentiment',
    releaseDate: latest.date,
    releaseKey: `consumer_sentiment:${latest.date}`,
    importanceScore,
    summary: `Consumer sentiment ${latest.value.toFixed(1)} (${signed(pointDelta, 1)} points MoM, ${signed(
      yoyPct,
      1
    )}% YoY).`,
    whyImportant,
    metrics: [
      {
        label: 'Sentiment Index',
        value: latest.value.toFixed(1),
        mom: `${signed(pointDelta, 1)} pts`,
        yoy: `${signed(yoyPct, 1)}%`,
      },
      {
        label: 'Monthly Percent Change',
        value: `${signed(momPct, 1)}%`,
      },
    ],
    sourceUrls: [`${FRED_SERIES_URL}UMCSENT`],
    tags: ['consumer sentiment', 'confidence', 'macro'],
    raw: {
      value: latest.value,
      pointDelta,
      momPct,
      yoyPct,
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
    whyImportant.push(
      'Home sales are stable, useful for trend confirmation and inflection detection.'
    );
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
    Math.abs(medianSalePriceYoY) * 2 +
      Math.abs(inventoryYoY) * 1.2 +
      Math.abs(monthsSupplyYoY) * 1.1
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
    whyImportant.push(
      'Housing supply and price changes remain a key read-through for affordability.'
    );
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

function firstPercentValue(input: string): number | null {
  const match = input.match(/(\d{1,3}(?:\.\d+)?)\s*%/);
  if (!match || !match[1]) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function clampSummary(text: string, maxLen = 220): string {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxLen) return compact;
  return `${compact.slice(0, maxLen - 1)}…`;
}

function canonicalGallupLink(link: string): string {
  return link.replace(/\?.*$/, '');
}

export async function fetchGallupPollsSnapshot(): Promise<DataDropSnapshot> {
  const rssText = await fetchText(GALLUP_POLITICS_RSS_URL);
  const items = parseGallupRss(rssText);
  if (items.length === 0) {
    throw new Error('Gallup RSS feed returned no parsable items');
  }

  const headlineItem = items.find((item) => item.link.includes('/poll/')) ?? items[0];
  const publishedAt = parseRfc822Date(headlineItem.pubDate);
  const releaseDate = publishedAt
    ? publishedAt.toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  const percentSignal = firstPercentValue(`${headlineItem.title} ${headlineItem.description}`);
  const daysSinceRelease = publishedAt
    ? Math.max(0, (Date.now() - publishedAt.getTime()) / (24 * 60 * 60 * 1000))
    : 999;
  const recencyScore = Math.max(5, 40 - daysSinceRelease * 1.5);
  const percentScore =
    percentSignal === null ? 15 : Math.min(40, Math.abs(percentSignal - 50) * 1.2);
  const languageSignal = /(record|new high|new low|surge|drops?|plunge|highest|lowest)/i.test(
    `${headlineItem.title} ${headlineItem.description}`
  )
    ? 20
    : 0;
  const importanceScore = Math.min(100, recencyScore + percentScore + languageSignal);

  const whyImportant = [
    `Latest Gallup headline: "${headlineItem.title}".`,
    publishedAt
      ? `Published ${monthYear(releaseDate)} with topic-level political sentiment context.`
      : 'Publication date unavailable; using most recent RSS item.',
  ];
  if (percentSignal !== null) {
    whyImportant.push(`Headline includes a ${percentSignal.toFixed(1)}% poll signal.`);
  }

  const summary = clampSummary(`${headlineItem.title} ${headlineItem.description}`);
  const articleUrl = canonicalGallupLink(headlineItem.link);

  return {
    datasetId: 'gallup_polls',
    datasetName: 'Gallup Polls (Government & Politics)',
    releaseDate,
    releaseKey: `gallup_polls:${releaseDate}`,
    importanceScore,
    summary,
    whyImportant,
    metrics: [
      {
        label: 'Headline Poll Signal',
        value: percentSignal === null ? 'n/a' : `${percentSignal.toFixed(1)}%`,
      },
      {
        label: 'Latest Poll Headline',
        value: headlineItem.title,
      },
      {
        label: 'Published',
        value: publishedAt ? publishedAt.toISOString() : headlineItem.pubDate,
      },
    ],
    sourceUrls: [GALLUP_POLITICS_RSS_URL, articleUrl],
    tags: ['gallup', 'polling', 'politics', 'public opinion'],
    raw: {
      title: headlineItem.title,
      description: clampSummary(headlineItem.description, 300),
      articleUrl,
      pubDate: headlineItem.pubDate,
      headlinePercent: percentSignal,
    },
  };
}

const SNAPSHOT_FETCHERS: Record<DatasetId, () => Promise<DataDropSnapshot>> = {
  jobs_report: fetchJobsSnapshot,
  nar_existing_home_sales: fetchNarSnapshot,
  redfin_national_housing: fetchRedfinSnapshot,
  gallup_polls: fetchGallupPollsSnapshot,
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
  {
    id: 'gallup_polls',
    datasetId: 'gallup_polls',
    datasetName: 'Gallup Polls',
    name: 'Gallup Polls',
    details: 'Gallup Government & Politics poll headline feed (RSS).',
    sourceUrl: GALLUP_POLITICS_RSS_URL,
    updateCadence: 'Weekly/rolling (RSS headlines)',
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
          value === 'redfin_national_housing' ||
          value === 'gallup_polls'
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
      typeof automation.combinedPosts === 'boolean'
        ? automation.combinedPosts
        : defaults.combinedPosts,
    maxPostsPerRun:
      typeof automation.maxPostsPerRun === 'number'
        ? automation.maxPostsPerRun
        : defaults.maxPostsPerRun,
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

  const forcedPublicationId =
    publicationIdOverride || process.env.DATA_DROP_AUTOMATION_PUBLICATION_ID;

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
  lines.push(
    '- Prioritize the indicators with the largest absolute month-over-month and year-over-year shifts.'
  );
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
      console.log(
        `[data-drop] Created combined draft publication=${target.id} sourceId=${combinedKey}`
      );
    }
  }

  return {
    publicationsChecked: targets.length,
    snapshotsFetched: snapshotsByDataset.size,
    draftsCreated,
  };
}
