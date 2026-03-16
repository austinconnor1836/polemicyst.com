'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

type LogEntry = {
  id: string;
  feedVideoId: string;
  jobType: string;
  status: string;
  message: string | null;
  error: string | null;
  durationMs: number | null;
  metadata: Record<string, unknown> | null;
  createdAt: string;
  feedVideo: {
    id: string;
    title: string;
    videoId: string;
    status: string;
  } | null;
};

type SummaryRow = {
  jobType: string;
  status: string;
  count: number;
};

type LogsData = {
  logs: LogEntry[];
  total: number;
  limit: number;
  offset: number;
  days: number;
  summary: SummaryRow[];
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  started: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const STATUS_DOT: Record<string, string> = {
  queued: 'bg-blue-500',
  started: 'bg-yellow-500 animate-pulse',
  completed: 'bg-green-500',
  failed: 'bg-red-500',
};

const JOB_TYPE_SHORT: Record<string, string> = {
  transcription: 'Transcribe',
  'speaker-transcription': 'Speaker',
  'clip-generation': 'Clip Gen',
  download: 'Download',
};

const JOB_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  'speaker-transcription': 'Speaker',
  'clip-generation': 'Clip Generation',
  download: 'Download',
};

const REFRESH_INTERVALS = [
  { label: 'Off', value: 0 },
  { label: '5s', value: 5000 },
  { label: '10s', value: 10000 },
  { label: '30s', value: 30000 },
];

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const secs = Math.floor(diff / 1000);
  if (secs < 60) return `${secs}s`;
  const mins = Math.floor(secs / 60);
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

export default function AdminLogsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<LogsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(1);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);
  const [refreshInterval, setRefreshInterval] = useState(0);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  const adminEmail = process.env.NEXT_PUBLIC_ADMIN_EMAIL;

  useEffect(() => {
    if (authStatus === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) {
      router.replace('/');
    }
  }, [session, authStatus, router, adminEmail]);

  const fetchLogs = useCallback(() => {
    if (authStatus === 'loading') return;
    if (!session?.user?.email || session.user.email !== adminEmail) return;

    setLoading((prev) => (data === null ? true : prev));
    const params = new URLSearchParams({ days: String(days), limit: '200' });
    if (jobTypeFilter !== 'all') params.set('jobType', jobTypeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);

    fetch(`/api/admin/logs?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        setData(d);
        setLastRefreshed(new Date());
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, jobTypeFilter, statusFilter, session, authStatus, adminEmail, data]);

  useEffect(() => {
    fetchLogs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days, jobTypeFilter, statusFilter, session, authStatus, adminEmail]);

  useEffect(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    if (refreshInterval > 0) {
      intervalRef.current = setInterval(fetchLogs, refreshInterval);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [refreshInterval, fetchLogs]);

  if (authStatus === 'loading' || (loading && !data)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="text-center space-y-2">
          <div className="w-6 h-6 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin mx-auto" />
          <p className="text-muted-foreground text-sm">Loading logs...</p>
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh] px-4">
        <div className="text-center space-y-3">
          <p className="text-red-500 text-sm">{error}</p>
          <button
            onClick={fetchLogs}
            className="px-4 py-2 rounded-lg bg-foreground text-background text-sm font-medium"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const summaryByType: Record<string, Record<string, number>> = {};
  for (const s of data.summary) {
    if (!summaryByType[s.jobType]) summaryByType[s.jobType] = {};
    summaryByType[s.jobType][s.status] = s.count;
  }

  const totalFailed = data.summary
    .filter((s) => s.status === 'failed')
    .reduce((a, b) => a + b.count, 0);
  const totalActive = data.summary
    .filter((s) => s.status === 'started')
    .reduce((a, b) => a + b.count, 0);
  const totalCompleted = data.summary
    .filter((s) => s.status === 'completed')
    .reduce((a, b) => a + b.count, 0);
  const totalQueued = data.summary
    .filter((s) => s.status === 'queued')
    .reduce((a, b) => a + b.count, 0);

  const recentFailures = data.logs.filter((l) => l.status === 'failed').slice(0, 5);

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-4 sm:py-6 space-y-4 sm:space-y-6">
      {/* Header with live indicator */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h1 className="text-lg sm:text-2xl font-bold truncate">Logs</h1>
          {refreshInterval > 0 && (
            <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 shrink-0">
              <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
              Live
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              showFilters || jobTypeFilter !== 'all' || statusFilter !== 'all'
                ? 'bg-foreground text-background'
                : 'bg-muted text-muted-foreground'
            }`}
          >
            Filters{jobTypeFilter !== 'all' || statusFilter !== 'all' ? ' *' : ''}
          </button>
          <button
            onClick={fetchLogs}
            className="px-2.5 py-1.5 rounded-lg text-xs bg-muted text-muted-foreground active:bg-muted/60"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Collapsible filters */}
      {showFilters && (
        <div className="space-y-3 p-3 rounded-xl bg-muted/30 border border-border/50">
          <div className="flex flex-wrap gap-2">
            <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
              <SelectTrigger className="w-full sm:w-[160px] h-9 text-xs">
                <SelectValue placeholder="Job type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                <SelectItem value="transcription">Transcription</SelectItem>
                <SelectItem value="speaker-transcription">Speaker</SelectItem>
                <SelectItem value="clip-generation">Clip Generation</SelectItem>
                <SelectItem value="download">Download</SelectItem>
              </SelectContent>
            </Select>

            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-full sm:w-[140px] h-9 text-xs">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                <SelectItem value="queued">Queued</SelectItem>
                <SelectItem value="started">Started</SelectItem>
                <SelectItem value="completed">Completed</SelectItem>
                <SelectItem value="failed">Failed</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex gap-1">
              {[1, 7, 14, 30].map((d) => (
                <button
                  key={d}
                  onClick={() => setDays(d)}
                  className={`px-2.5 py-1 rounded text-xs font-medium ${
                    days === d ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>

            <Select
              value={String(refreshInterval)}
              onValueChange={(v) => setRefreshInterval(Number(v))}
            >
              <SelectTrigger className="w-[90px] h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_INTERVALS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Quick-access refresh bar (always visible when filters hidden) */}
      {!showFilters && (
        <div className="flex items-center justify-between gap-2">
          <div className="flex gap-1">
            {[1, 7, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-2 py-1 rounded text-xs font-medium ${
                  days === d ? 'bg-foreground text-background' : 'bg-muted text-muted-foreground'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Select
              value={String(refreshInterval)}
              onValueChange={(v) => setRefreshInterval(Number(v))}
            >
              <SelectTrigger className="w-[80px] h-7 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REFRESH_INTERVALS.map((r) => (
                  <SelectItem key={r.value} value={String(r.value)}>
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lastRefreshed && (
              <span className="text-[10px] text-muted-foreground">
                {lastRefreshed.toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit',
                  second: '2-digit',
                })}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Health overview strip */}
      <div className="grid grid-cols-4 gap-2">
        <button
          onClick={() => {
            setStatusFilter('failed');
            setShowFilters(false);
          }}
          className={`rounded-xl p-2.5 text-center transition-colors ${
            totalFailed > 0
              ? 'bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900/50 active:bg-red-100'
              : 'bg-muted/30 border border-border/30'
          }`}
        >
          <p
            className={`text-lg sm:text-xl font-bold ${totalFailed > 0 ? 'text-red-600 dark:text-red-400' : 'text-muted-foreground'}`}
          >
            {totalFailed}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Failed</p>
        </button>
        <button
          onClick={() => {
            setStatusFilter('started');
            setShowFilters(false);
          }}
          className={`rounded-xl p-2.5 text-center transition-colors ${
            totalActive > 0
              ? 'bg-yellow-50 dark:bg-yellow-950/30 border border-yellow-200 dark:border-yellow-900/50 active:bg-yellow-100'
              : 'bg-muted/30 border border-border/30'
          }`}
        >
          <p
            className={`text-lg sm:text-xl font-bold ${totalActive > 0 ? 'text-yellow-600 dark:text-yellow-400' : 'text-muted-foreground'}`}
          >
            {totalActive}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Active</p>
        </button>
        <button
          onClick={() => {
            setStatusFilter('queued');
            setShowFilters(false);
          }}
          className="rounded-xl p-2.5 text-center bg-muted/30 border border-border/30 transition-colors active:bg-muted/50"
        >
          <p className="text-lg sm:text-xl font-bold text-muted-foreground">{totalQueued}</p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Queued</p>
        </button>
        <button
          onClick={() => {
            setStatusFilter('completed');
            setShowFilters(false);
          }}
          className="rounded-xl p-2.5 text-center bg-muted/30 border border-border/30 transition-colors active:bg-muted/50"
        >
          <p className="text-lg sm:text-xl font-bold text-green-600 dark:text-green-400">
            {totalCompleted}
          </p>
          <p className="text-[10px] sm:text-xs text-muted-foreground">Done</p>
        </button>
      </div>

      {/* Failure alert card */}
      {recentFailures.length > 0 && statusFilter !== 'failed' && (
        <Card className="border-red-200 dark:border-red-900/50 bg-red-50/50 dark:bg-red-950/20">
          <CardHeader className="pb-2 px-3 pt-3">
            <CardTitle className="text-sm font-semibold text-red-700 dark:text-red-400 flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-red-500" />
              Recent Failures
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 space-y-1.5">
            {recentFailures.map((log) => (
              <div
                key={log.id}
                className="text-xs p-2 rounded-lg bg-white/50 dark:bg-black/20 cursor-pointer active:bg-white/80"
                onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
              >
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                    {JOB_TYPE_SHORT[log.jobType] || log.jobType}
                  </Badge>
                  <span className="flex-1 truncate text-red-700 dark:text-red-300">
                    {log.error?.split('\n')[0]?.slice(0, 80) || log.message || 'Unknown error'}
                  </span>
                  <span className="text-muted-foreground shrink-0">
                    {formatTimeAgo(log.createdAt)}
                  </span>
                </div>
                {expandedLogId === log.id && log.error && (
                  <pre className="mt-2 text-[11px] bg-red-100 dark:bg-red-950/40 text-red-800 dark:text-red-300 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all max-h-40 overflow-y-auto">
                    {log.error}
                  </pre>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      {/* Job type summary cards */}
      {Object.keys(summaryByType).length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(summaryByType).map(([jobType, statuses]) => {
            const total = Object.values(statuses).reduce((a, b) => a + b, 0);
            const failed = statuses.failed || 0;
            const completed = statuses.completed || 0;
            return (
              <button
                key={jobType}
                onClick={() => {
                  setJobTypeFilter(jobType);
                  setShowFilters(false);
                }}
                className={`rounded-xl p-2.5 text-left transition-colors active:bg-muted/50 ${
                  jobTypeFilter === jobType
                    ? 'bg-foreground/5 border-2 border-foreground/20'
                    : 'bg-muted/20 border border-border/30'
                }`}
              >
                <p className="text-xs text-muted-foreground truncate">
                  {JOB_TYPE_LABELS[jobType] || jobType}
                </p>
                <p className="text-base font-bold mt-0.5">{total}</p>
                <div className="flex gap-1.5 mt-0.5">
                  {completed > 0 && (
                    <span className="text-[10px] text-green-600 dark:text-green-400">
                      {completed} ok
                    </span>
                  )}
                  {failed > 0 && (
                    <span className="text-[10px] text-red-600 dark:text-red-400">{failed} err</span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* Active filter indicator */}
      {(jobTypeFilter !== 'all' || statusFilter !== 'all') && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Filtering:</span>
          {jobTypeFilter !== 'all' && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              {JOB_TYPE_LABELS[jobTypeFilter] || jobTypeFilter}
              <button
                onClick={() => setJobTypeFilter('all')}
                className="ml-0.5 hover:text-foreground"
              >
                &times;
              </button>
            </Badge>
          )}
          {statusFilter !== 'all' && (
            <Badge variant="secondary" className="text-[10px] gap-1">
              {statusFilter}
              <button
                onClick={() => setStatusFilter('all')}
                className="ml-0.5 hover:text-foreground"
              >
                &times;
              </button>
            </Badge>
          )}
          <button
            onClick={() => {
              setJobTypeFilter('all');
              setStatusFilter('all');
            }}
            className="text-muted-foreground hover:text-foreground ml-auto"
          >
            Clear
          </button>
        </div>
      )}

      {/* Log entries */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-muted-foreground">
            {data.total} log{data.total !== 1 ? 's' : ''}
            {data.total > data.limit ? ` (showing ${data.limit})` : ''}
          </span>
        </div>

        {data.logs.length === 0 ? (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No logs match the current filters.
          </div>
        ) : (
          <div className="space-y-1.5">
            {data.logs.map((log) => (
              <div
                key={log.id}
                className="border border-border/40 rounded-xl p-2.5 sm:p-3 active:bg-muted/30 transition-colors cursor-pointer"
                onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[log.status] || 'bg-gray-400'}`}
                  />
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">
                    {JOB_TYPE_SHORT[log.jobType] || log.jobType}
                  </Badge>
                  <span className="text-xs text-muted-foreground flex-1 min-w-0 truncate">
                    {log.message || (log.error ? log.error.split('\n')[0]?.slice(0, 60) : '-')}
                  </span>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {log.durationMs !== null && (
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {formatDuration(log.durationMs)}
                      </span>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {formatTimeAgo(log.createdAt)}
                    </span>
                  </div>
                </div>

                {expandedLogId === log.id && (
                  <div className="mt-2.5 pt-2.5 border-t border-border/40 space-y-2 text-xs">
                    <div className="space-y-1">
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Status</span>
                        <span
                          className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${STATUS_COLORS[log.status] || ''}`}
                        >
                          {log.status}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Video</span>
                        <span className="truncate">{log.feedVideo?.title || log.feedVideoId}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">ID</span>
                        <span className="font-mono text-[10px] break-all">{log.feedVideoId}</span>
                      </div>
                      <div className="flex gap-2">
                        <span className="text-muted-foreground w-16 shrink-0">Time</span>
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                      </div>
                      {log.durationMs !== null && (
                        <div className="flex gap-2">
                          <span className="text-muted-foreground w-16 shrink-0">Duration</span>
                          <span>{formatDuration(log.durationMs)}</span>
                        </div>
                      )}
                    </div>
                    {log.error && (
                      <div>
                        <p className="text-[10px] font-semibold text-red-600 dark:text-red-400 mb-1">
                          Error
                        </p>
                        <pre className="text-[11px] bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-48 overflow-y-auto">
                          {log.error}
                        </pre>
                      </div>
                    )}
                    {log.metadata && (
                      <div>
                        <p className="text-[10px] font-semibold text-muted-foreground mb-1">
                          Metadata
                        </p>
                        <pre className="text-[10px] bg-muted/30 p-2 rounded-lg overflow-x-auto whitespace-pre-wrap break-all max-h-32 overflow-y-auto">
                          {JSON.stringify(log.metadata, null, 2)}
                        </pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
