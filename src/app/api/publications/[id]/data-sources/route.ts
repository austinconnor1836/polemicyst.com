import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { getAuthenticatedUser } from '@shared/lib/auth-helpers';
import { prisma } from '@shared/lib/prisma';
import { getSupportedDataSources, type DatasetId } from '@shared/lib/data-drop-automation';
import { getDataDropSchedulePreview } from '@shared/lib/data-drop-schedule';

type DataDropAutomationConfig = {
  enabled: boolean;
  datasets: DatasetId[];
  minImportanceScore: number;
  combinedPosts: boolean;
  maxPostsPerRun: number;
};

const DEFAULT_CONFIG: DataDropAutomationConfig = {
  enabled: false,
  datasets: [
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
  ],
  minImportanceScore: 35,
  combinedPosts: true,
  maxPostsPerRun: 3,
};

function parseConfig(configJson: unknown): DataDropAutomationConfig {
  if (!configJson || typeof configJson !== 'object') return { ...DEFAULT_CONFIG };
  const top = configJson as Record<string, unknown>;
  const raw = top.dataDropAutomation;
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_CONFIG };
  const source = raw as Record<string, unknown>;

  const datasets = Array.isArray(source.datasets)
    ? source.datasets.filter(
        (value): value is DatasetId =>
          value === 'jobs_report' ||
          value === 'cpi_inflation' ||
          value === 'jobless_claims' ||
          value === 'retail_sales' ||
          value === 'housing_starts' ||
          value === 'building_permits' ||
          value === 'yield_curve_spread' ||
          value === 'consumer_sentiment' ||
          value === 'nar_existing_home_sales' ||
          value === 'redfin_national_housing' ||
          value === 'gallup_polls' ||
          value === 'gallup_economy'
      )
    : DEFAULT_CONFIG.datasets;

  return {
    enabled: source.enabled === true,
    datasets: datasets.length > 0 ? datasets : [...DEFAULT_CONFIG.datasets],
    minImportanceScore:
      typeof source.minImportanceScore === 'number'
        ? Math.max(0, Math.min(100, source.minImportanceScore))
        : DEFAULT_CONFIG.minImportanceScore,
    combinedPosts:
      typeof source.combinedPosts === 'boolean'
        ? source.combinedPosts
        : DEFAULT_CONFIG.combinedPosts,
    maxPostsPerRun:
      typeof source.maxPostsPerRun === 'number'
        ? Math.max(1, Math.min(10, Math.floor(source.maxPostsPerRun)))
        : DEFAULT_CONFIG.maxPostsPerRun,
  };
}

function mergeConfigJson(
  original: Prisma.JsonValue | null,
  config: DataDropAutomationConfig
): Prisma.InputJsonObject {
  const base =
    original && typeof original === 'object' && !Array.isArray(original)
      ? (original as Prisma.InputJsonObject)
      : {};

  return {
    ...base,
    dataDropAutomation: {
      enabled: config.enabled,
      datasets: config.datasets,
      minImportanceScore: config.minImportanceScore,
      combinedPosts: config.combinedPosts,
      maxPostsPerRun: config.maxPostsPerRun,
    },
  };
}

function buildResponse(publicationId: string, config: DataDropAutomationConfig) {
  const cadence = getDataDropSchedulePreview();
  const active = new Set(config.datasets);
  const sources = getSupportedDataSources();

  return {
    publicationId,
    config,
    cadencePreview: {
      mode: cadence.cadence.mode,
      intervalMs: cadence.cadence.intervalMs,
      baselineIntervalMs: cadence.baselineIntervalMs,
      releaseWindowIntervalMs: cadence.windowIntervalMs,
      leadMinutes: cadence.windowLeadMinutes,
      lagMinutes: cadence.windowLagMinutes,
      activeWindows: cadence.cadence.activeWindows.map((window) => ({
        datasetId: window.datasetId,
        datasetName: window.datasetName,
        scheduledAt: window.scheduledAt.toISOString(),
      })),
    },
    sources: sources.map((source) => ({
      datasetId: source.id,
      datasetName: source.name,
      connected: true,
      included: active.has(source.id),
      lastSuccessfulReleaseDate: null,
      latestImportanceScore: null,
    })),
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const publication = await prisma.publication.findFirst({
      where: { id, userId: user.id },
      select: { id: true, configJson: true },
    });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const config = parseConfig(publication.configJson);
    return NextResponse.json(buildResponse(publication.id, config));
  } catch (err) {
    console.error('[GET /api/publications/:id/data-sources] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to load data source settings' }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getAuthenticatedUser(req);
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const publication = await prisma.publication.findFirst({
      where: { id, userId: user.id },
      select: { id: true, configJson: true },
    });
    if (!publication) {
      return NextResponse.json({ error: 'Publication not found' }, { status: 404 });
    }

    const body = await req.json();
    const datasetsInput = Array.isArray(body.datasets) ? body.datasets : [];
    const datasets = datasetsInput.filter(
      (value: unknown): value is DatasetId =>
        value === 'jobs_report' ||
        value === 'cpi_inflation' ||
        value === 'jobless_claims' ||
        value === 'retail_sales' ||
        value === 'housing_starts' ||
        value === 'building_permits' ||
        value === 'yield_curve_spread' ||
        value === 'consumer_sentiment' ||
        value === 'nar_existing_home_sales' ||
        value === 'redfin_national_housing' ||
        value === 'gallup_polls' ||
        value === 'gallup_economy'
    );

    const nextConfig: DataDropAutomationConfig = {
      enabled: body.enabled === true,
      datasets: datasets.length > 0 ? datasets : [...DEFAULT_CONFIG.datasets],
      minImportanceScore:
        typeof body.minImportanceScore === 'number'
          ? Math.max(0, Math.min(100, body.minImportanceScore))
          : DEFAULT_CONFIG.minImportanceScore,
      combinedPosts:
        typeof body.combinedPosts === 'boolean' ? body.combinedPosts : DEFAULT_CONFIG.combinedPosts,
      maxPostsPerRun:
        typeof body.maxPostsPerRun === 'number'
          ? Math.max(1, Math.min(10, Math.floor(body.maxPostsPerRun)))
          : DEFAULT_CONFIG.maxPostsPerRun,
    };

    const mergedConfigJson = mergeConfigJson(publication.configJson, nextConfig);
    await prisma.publication.update({
      where: { id },
      data: { configJson: mergedConfigJson },
    });

    return NextResponse.json(buildResponse(publication.id, nextConfig));
  } catch (err) {
    console.error('[PUT /api/publications/:id/data-sources] Unhandled error:', err);
    return NextResponse.json({ error: 'Failed to update data source settings' }, { status: 500 });
  }
}
