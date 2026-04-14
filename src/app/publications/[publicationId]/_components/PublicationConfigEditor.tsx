'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Loader2, Save, Database, FlaskConical } from 'lucide-react';
import toast from 'react-hot-toast';

type DataSourceDatasetId =
  | 'jobs_report'
  | 'nar_existing_home_sales'
  | 'redfin_national_housing'
  | 'gallup_polls'
  | 'cpi_inflation'
  | 'jobless_claims'
  | 'retail_sales'
  | 'housing_starts_permits'
  | 'yield_curve_spread'
  | 'consumer_sentiment'
  | 'gallup_economy'
  | 'gallup_social';

type DataSourceStatus = {
  datasetId: DataSourceDatasetId;
  datasetName: string;
  connected: boolean;
  included: boolean;
  lastSuccessfulReleaseDate?: string;
  latestImportanceScore?: number;
};

type DataSourceConfig = {
  enabled: boolean;
  datasets: DataSourceDatasetId[];
  minImportanceScore: number;
  combinedPosts: boolean;
  maxPostsPerRun: number;
};

type CadencePreview = {
  mode: 'baseline' | 'release-window';
  intervalMs: number;
  baselineIntervalMs: number;
  releaseWindowIntervalMs: number;
  leadMinutes: number;
  lagMinutes: number;
  activeWindows: Array<{
    datasetId: DataSourceDatasetId;
    datasetName: string;
    scheduledAt: string;
  }>;
};

type DataSourcesResponse = {
  publicationId: string;
  config: DataSourceConfig;
  cadencePreview: CadencePreview;
  sources: DataSourceStatus[];
};

type DataSourcesTestResult = {
  ranAt: string;
  snapshotsFetched: number;
  draftsCreated: number;
};

interface PublicationConfigEditorProps {
  publicationId: string;
  initialName: string;
  initialTagline: string;
  initialConfigMarkdown: string;
  onSave?: () => void;
}

export default function PublicationConfigEditor({
  publicationId,
  initialName,
  initialTagline,
  initialConfigMarkdown,
  onSave,
}: PublicationConfigEditorProps) {
  const [name, setName] = useState(initialName);
  const [tagline, setTagline] = useState(initialTagline);
  const [configMarkdown, setConfigMarkdown] = useState(initialConfigMarkdown);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [dataSourcesLoading, setDataSourcesLoading] = useState(true);
  const [dataSourcesSaving, setDataSourcesSaving] = useState(false);
  const [dataSourcesTesting, setDataSourcesTesting] = useState(false);
  const [dataSources, setDataSources] = useState<DataSourcesResponse | null>(null);
  const [lastTestResult, setLastTestResult] = useState<DataSourcesTestResult | null>(null);

  useEffect(() => {
    const hasChanges =
      name !== initialName ||
      tagline !== initialTagline ||
      configMarkdown !== initialConfigMarkdown;
    setDirty(hasChanges);
  }, [name, tagline, configMarkdown, initialName, initialTagline, initialConfigMarkdown]);

  const fetchDataSources = useCallback(async () => {
    setDataSourcesLoading(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}/data-sources`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: 'Failed to load data sources' }));
        throw new Error(data.error || 'Failed to load data sources');
      }
      const data: DataSourcesResponse = await res.json();
      setDataSources(data);
    } catch (error) {
      console.error('Failed to load data sources:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to load data sources');
    } finally {
      setDataSourcesLoading(false);
    }
  }, [publicationId]);

  useEffect(() => {
    fetchDataSources();
  }, [fetchDataSources]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/publications/${publicationId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, tagline, configMarkdown }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to save');
      }
      setDirty(false);
      onSave?.();
    } catch (err) {
      console.error('Save failed:', err);
      alert(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }, [publicationId, name, tagline, configMarkdown, onSave]);

  const saveDataSources = useCallback(
    async (nextConfig: DataSourceConfig) => {
      setDataSourcesSaving(true);
      try {
        const res = await fetch(`/api/publications/${publicationId}/data-sources`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(nextConfig),
        });
        if (!res.ok) {
          const data = await res
            .json()
            .catch(() => ({ error: 'Failed to save data source config' }));
          throw new Error(data.error || 'Failed to save data source config');
        }
        const data: DataSourcesResponse = await res.json();
        setDataSources(data);
        toast.success('Data source settings saved');
      } catch (error) {
        console.error('Failed saving data source config:', error);
        toast.error(error instanceof Error ? error.message : 'Failed to save data source config');
      } finally {
        setDataSourcesSaving(false);
      }
    },
    [publicationId]
  );

  const updateDataSourceConfig = useCallback(
    (patch: Partial<DataSourceConfig>) => {
      if (!dataSources || dataSourcesSaving) return;
      const nextConfig: DataSourceConfig = {
        ...dataSources.config,
        ...patch,
      };
      void saveDataSources(nextConfig);
    },
    [dataSources, dataSourcesSaving, saveDataSources]
  );

  const toggleDataset = useCallback(
    (datasetId: DataSourceDatasetId) => {
      if (!dataSources || dataSourcesSaving) return;
      const exists = dataSources.config.datasets.includes(datasetId);
      const nextDatasets = exists
        ? dataSources.config.datasets.filter((id) => id !== datasetId)
        : [...dataSources.config.datasets, datasetId];
      updateDataSourceConfig({ datasets: nextDatasets });
    },
    [dataSources, dataSourcesSaving, updateDataSourceConfig]
  );

  const runDataSourcesTest = useCallback(async () => {
    setDataSourcesTesting(true);
    setLastTestResult(null);
    try {
      const res = await fetch(`/api/publications/${publicationId}/data-sources/test`, {
        method: 'POST',
      });
      const data = await res.json().catch(() => ({}) as Record<string, any>);
      if (!res.ok) {
        throw new Error(data?.error || 'Data source test failed');
      }
      setLastTestResult({
        ranAt: data?.ranAt || new Date().toISOString(),
        snapshotsFetched: Number(data?.snapshotsFetched ?? 0),
        draftsCreated: Number(data?.draftsCreated ?? 0),
      });
      toast.success(
        `Dry run complete: ${data?.snapshotsFetched ?? 0} snapshots, ${data?.draftsCreated ?? 0} drafts created`
      );
      await fetchDataSources();
    } catch (error) {
      console.error('Failed running data source test:', error);
      toast.error(error instanceof Error ? error.message : 'Data source test failed');
    } finally {
      setDataSourcesTesting(false);
    }
  }, [publicationId, fetchDataSources]);

  // Parse some preview info from the config
  const previewLines = configMarkdown.split('\n');
  const voiceLine = previewLines.find((l) => l.match(/^-\s*tone:/i));
  const accentLine = previewLines.find((l) => l.match(/^-\s*accentColor:/i));
  const headerFontLine = previewLines.find((l) => l.match(/^-\s*headerFont:/i));
  const frameworkCount = previewLines.filter((l) => l.match(/^###\s*Framework:/i)).length;

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {/* Editor */}
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="pub-name">Publication Name</Label>
            <Input
              id="pub-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Publication"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="pub-tagline">Tagline</Label>
            <Input
              id="pub-tagline"
              value={tagline}
              onChange={(e) => setTagline(e.target.value)}
              placeholder="Your tagline"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="pub-config">Publication Config (Markdown)</Label>
          <Textarea
            id="pub-config"
            value={configMarkdown}
            onChange={(e) => setConfigMarkdown(e.target.value)}
            className="min-h-[500px] font-mono text-sm"
            placeholder="Enter your publication config markdown..."
          />
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving || !dirty}>
            {saving ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Save className="mr-2 h-4 w-4" />
            )}
            Save Config
          </Button>
          {dirty && <span className="text-sm text-muted-foreground">Unsaved changes</span>}
        </div>
      </div>

      {/* Preview sidebar */}
      <div className="space-y-4">
        <div className="rounded-lg border bg-muted/50 p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-muted-foreground" />
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Connected Data Sources
              </h3>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={runDataSourcesTest}
              disabled={dataSourcesTesting || dataSourcesLoading || dataSourcesSaving}
            >
              {dataSourcesTesting ? (
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              ) : (
                <FlaskConical className="mr-1 h-3 w-3" />
              )}
              Test now
            </Button>
          </div>

          {dataSourcesLoading || !dataSources ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading data source status…
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between rounded-md border bg-background/70 p-2">
                <div>
                  <div className="text-sm font-medium">Enable automation</div>
                  <div className="text-xs text-muted-foreground">
                    Create data-drop article drafts automatically
                  </div>
                </div>
                <Switch
                  checked={dataSources.config.enabled}
                  disabled={dataSourcesSaving}
                  onCheckedChange={(checked) => updateDataSourceConfig({ enabled: checked })}
                />
              </div>

              <div className="space-y-2">
                {dataSources.sources.map((source) => {
                  const isIncluded = dataSources.config.datasets.includes(source.datasetId);
                  return (
                    <div key={source.datasetId} className="rounded-md border bg-background/70 p-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <div className="text-sm font-medium">{source.datasetName}</div>
                          <div className="mt-1 flex flex-wrap gap-1">
                            <Badge variant={source.connected ? 'secondary' : 'destructive'}>
                              {source.connected ? 'Connected' : 'Unavailable'}
                            </Badge>
                            <Badge variant={isIncluded ? 'default' : 'outline'}>
                              {isIncluded ? 'Included' : 'Excluded'}
                            </Badge>
                          </div>
                          <div className="mt-1 text-xs text-muted-foreground">
                            {source.lastSuccessfulReleaseDate
                              ? `Last release: ${source.lastSuccessfulReleaseDate}`
                              : 'No recent release parsed'}
                            {typeof source.latestImportanceScore === 'number'
                              ? ` • Score ${source.latestImportanceScore.toFixed(1)}`
                              : ''}
                          </div>
                        </div>
                        <Switch
                          checked={isIncluded}
                          disabled={dataSourcesSaving}
                          onCheckedChange={() => toggleDataset(source.datasetId)}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="space-y-2 rounded-md border bg-background/70 p-2">
                <div className="flex items-center justify-between">
                  <Label className="text-sm">Minimum importance score</Label>
                  <span className="text-xs text-muted-foreground">
                    {dataSources.config.minImportanceScore.toFixed(0)}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={dataSources.config.minImportanceScore}
                  disabled={dataSourcesSaving}
                  onChange={(e) =>
                    updateDataSourceConfig({ minImportanceScore: parseInt(e.target.value, 10) })
                  }
                  className="w-full accent-primary"
                />
                <div className="text-xs text-muted-foreground">
                  Only releases scoring above this threshold create drafts.
                </div>
              </div>

              <div className="rounded-md border bg-background/70 p-2">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">Multi-dataset synthesis</div>
                    <div className="text-xs text-muted-foreground">
                      Generate combined posts when multiple datasets are meaningful
                    </div>
                  </div>
                  <Switch
                    checked={dataSources.config.combinedPosts}
                    disabled={dataSourcesSaving}
                    onCheckedChange={(checked) =>
                      updateDataSourceConfig({ combinedPosts: checked })
                    }
                  />
                </div>
              </div>

              <div className="rounded-md border bg-background/70 p-2 text-xs text-muted-foreground">
                <div>
                  Cadence:{' '}
                  <span className="font-medium text-foreground">
                    {dataSources.cadencePreview.mode}
                  </span>
                  {' • '}
                  every {(dataSources.cadencePreview.intervalMs / 60000).toFixed(0)}m
                </div>
                <div>
                  Baseline {(dataSources.cadencePreview.baselineIntervalMs / 60000).toFixed(0)}m,
                  release window{' '}
                  {(dataSources.cadencePreview.releaseWindowIntervalMs / 60000).toFixed(0)}m (lead{' '}
                  {dataSources.cadencePreview.leadMinutes}m / lag{' '}
                  {dataSources.cadencePreview.lagMinutes}m)
                </div>
              </div>

              {lastTestResult && (
                <div className="rounded-md border bg-background/70 p-2 text-xs text-muted-foreground">
                  <span className="font-medium text-foreground">Last dry run:</span>{' '}
                  {lastTestResult.snapshotsFetched} snapshots, {lastTestResult.draftsCreated} drafts{' '}
                  at {new Date(lastTestResult.ranAt).toLocaleTimeString()}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="rounded-lg border bg-muted/50 p-4">
          <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Config Preview
          </h3>
          <dl className="space-y-2 text-sm">
            <div>
              <dt className="font-medium">Name</dt>
              <dd className="text-muted-foreground">{name || '—'}</dd>
            </div>
            <div>
              <dt className="font-medium">Tagline</dt>
              <dd className="text-muted-foreground">{tagline || '—'}</dd>
            </div>
            {voiceLine && (
              <div>
                <dt className="font-medium">Voice</dt>
                <dd className="text-muted-foreground">{voiceLine.replace(/^-\s*tone:\s*/i, '')}</dd>
              </div>
            )}
            {accentLine && (
              <div>
                <dt className="font-medium">Accent Color</dt>
                <dd className="flex items-center gap-2 text-muted-foreground">
                  <span
                    className="inline-block h-4 w-4 rounded border"
                    style={{
                      backgroundColor: accentLine.replace(/^-\s*accentColor:\s*/i, '').trim(),
                    }}
                    aria-hidden="true"
                  />
                  {accentLine.replace(/^-\s*accentColor:\s*/i, '').trim()}
                </dd>
              </div>
            )}
            {headerFontLine && (
              <div>
                <dt className="font-medium">Header Font</dt>
                <dd className="text-muted-foreground">
                  {headerFontLine.replace(/^-\s*headerFont:\s*/i, '').trim()}
                </dd>
              </div>
            )}
            <div>
              <dt className="font-medium">Frameworks</dt>
              <dd className="text-muted-foreground">
                {frameworkCount > 0 ? `${frameworkCount} defined` : 'None'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
