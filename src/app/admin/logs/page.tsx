'use client';

import { useEffect, useState, useCallback } from 'react';
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

const JOB_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  'speaker-transcription': 'Speaker Transcription',
  'clip-generation': 'Clip Generation',
  download: 'Download',
};

function formatDuration(ms: number | null): string {
  if (ms === null) return '-';
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

function formatTimeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function AdminLogsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<LogsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [jobTypeFilter, setJobTypeFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [expandedLogId, setExpandedLogId] = useState<string | null>(null);

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

    setLoading(true);
    const params = new URLSearchParams({ days: String(days), limit: '200' });
    if (jobTypeFilter !== 'all') params.set('jobType', jobTypeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);

    fetch(`/api/admin/logs?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, jobTypeFilter, statusFilter, session, authStatus, adminEmail]);

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  if (authStatus === 'loading' || loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-muted-foreground">Loading job logs...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const summaryByType: Record<string, Record<string, number>> = {};
  for (const s of data.summary) {
    if (!summaryByType[s.jobType]) summaryByType[s.jobType] = {};
    summaryByType[s.jobType][s.status] = s.count;
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <h1 className="text-2xl font-bold">Job Logs</h1>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Job type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="transcription">Transcription</SelectItem>
              <SelectItem value="speaker-transcription">Speaker Transcription</SelectItem>
              <SelectItem value="clip-generation">Clip Generation</SelectItem>
              <SelectItem value="download">Download</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[150px]">
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

          <div className="flex gap-1">
            {[1, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded text-sm ${
                  days === d
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <button
            onClick={fetchLogs}
            className="px-3 py-1.5 rounded text-sm bg-muted text-muted-foreground hover:bg-muted/80"
          >
            Refresh
          </button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Object.entries(summaryByType).map(([jobType, statuses]) => {
          const total = Object.values(statuses).reduce((a, b) => a + b, 0);
          const failed = statuses.failed || 0;
          const completed = statuses.completed || 0;
          return (
            <Card key={jobType}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {JOB_TYPE_LABELS[jobType] || jobType}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{total}</p>
                <div className="flex gap-2 mt-1 text-xs">
                  {completed > 0 && (
                    <span className="text-green-600 dark:text-green-400">{completed} ok</span>
                  )}
                  {failed > 0 && (
                    <span className="text-red-600 dark:text-red-400">{failed} failed</span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
        {Object.keys(summaryByType).length === 0 && (
          <Card className="col-span-full">
            <CardContent className="pt-6">
              <p className="text-muted-foreground text-sm text-center">
                No job logs recorded in the last {days} day{days > 1 ? 's' : ''}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Logs table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            <span>Recent Logs</span>
            <span className="text-sm font-normal text-muted-foreground">
              {data.total} total{data.total > data.limit ? ` (showing ${data.limit})` : ''}
            </span>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {data.logs.length === 0 ? (
            <p className="text-muted-foreground text-sm text-center py-8">
              No logs match the current filters.
            </p>
          ) : (
            <div className="space-y-2">
              {data.logs.map((log) => (
                <div
                  key={log.id}
                  className="border border-border/50 rounded-lg p-3 hover:bg-muted/30 transition-colors cursor-pointer"
                  onClick={() => setExpandedLogId(expandedLogId === log.id ? null : log.id)}
                >
                  <div className="flex items-center gap-3 flex-wrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[log.status] || ''}`}
                    >
                      {log.status}
                    </span>
                    <Badge variant="secondary">{JOB_TYPE_LABELS[log.jobType] || log.jobType}</Badge>
                    <span className="text-sm text-muted-foreground flex-1 min-w-0 truncate">
                      {log.message || '-'}
                    </span>
                    {log.durationMs !== null && (
                      <span className="text-xs font-mono text-muted-foreground">
                        {formatDuration(log.durationMs)}
                      </span>
                    )}
                    <span className="text-xs text-muted-foreground whitespace-nowrap">
                      {formatTimeAgo(log.createdAt)}
                    </span>
                  </div>

                  {expandedLogId === log.id && (
                    <div className="mt-3 pt-3 border-t border-border/50 space-y-2 text-sm">
                      <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
                        <span className="text-muted-foreground">Video</span>
                        <span className="truncate">{log.feedVideo?.title || log.feedVideoId}</span>
                        <span className="text-muted-foreground">Feed Video ID</span>
                        <span className="font-mono text-xs">{log.feedVideoId}</span>
                        <span className="text-muted-foreground">Timestamp</span>
                        <span>{new Date(log.createdAt).toLocaleString()}</span>
                        {log.durationMs !== null && (
                          <>
                            <span className="text-muted-foreground">Duration</span>
                            <span>{formatDuration(log.durationMs)}</span>
                          </>
                        )}
                      </div>
                      {log.error && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-red-600 dark:text-red-400 mb-1">
                            Error
                          </p>
                          <pre className="text-xs bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                            {log.error}
                          </pre>
                        </div>
                      )}
                      {log.metadata && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-muted-foreground mb-1">Metadata</p>
                          <pre className="text-xs bg-muted/30 p-2 rounded overflow-x-auto">
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
        </CardContent>
      </Card>
    </div>
  );
}
