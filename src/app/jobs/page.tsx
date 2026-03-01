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
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, CheckCircle2, XCircle, Clock, Play } from 'lucide-react';

type FeedVideoRef = {
  id: string;
  title: string;
  videoId: string;
  status: string;
  clipGenerationStatus: string;
  thumbnailUrl: string | null;
  feed: { id: string; name: string } | null;
};

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
  feedVideo: FeedVideoRef | null;
};

type ActiveVideo = {
  id: string;
  title: string;
  clipGenerationStatus: string;
  thumbnailUrl: string | null;
  feed: { name: string } | null;
};

type SummaryRow = { jobType: string; status: string; count: number };

type JobsData = {
  logs: LogEntry[];
  activeVideos: ActiveVideo[];
  summary: SummaryRow[];
};

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued: <Clock className="h-4 w-4 text-blue-500" />,
  started: <Play className="h-4 w-4 text-yellow-500" />,
  completed: <CheckCircle2 className="h-4 w-4 text-green-500" />,
  failed: <XCircle className="h-4 w-4 text-red-500" />,
};

const STATUS_COLORS: Record<string, string> = {
  queued: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  started: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  processing: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300',
  completed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  failed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const JOB_TYPE_LABELS: Record<string, string> = {
  transcription: 'Transcription',
  'speaker-transcription': 'Speaker ID',
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

function groupByVideo(logs: LogEntry[]) {
  const groups: Record<string, { video: FeedVideoRef | null; logs: LogEntry[] }> = {};
  for (const log of logs) {
    const key = log.feedVideoId;
    if (!groups[key]) groups[key] = { video: log.feedVideo, logs: [] };
    groups[key].logs.push(log);
  }
  return Object.entries(groups);
}

export default function JobsPage() {
  const { data: session, status: authStatus } = useSession();
  const router = useRouter();
  const [data, setData] = useState<JobsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [days, setDays] = useState(7);
  const [jobTypeFilter, setJobTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [expandedVideoId, setExpandedVideoId] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (authStatus !== 'loading' && !session) {
      router.replace('/auth/signin');
    }
  }, [session, authStatus, router]);

  const fetchJobs = useCallback(() => {
    if (!session) return;
    const params = new URLSearchParams({ days: String(days) });
    if (jobTypeFilter !== 'all') params.set('jobType', jobTypeFilter);
    if (statusFilter !== 'all') params.set('status', statusFilter);

    fetch(`/api/jobs?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((d) => {
        setData(d);
        setError(null);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [days, jobTypeFilter, statusFilter, session]);

  useEffect(() => {
    setLoading(true);
    fetchJobs();
  }, [fetchJobs]);

  useEffect(() => {
    if (autoRefresh) {
      intervalRef.current = setInterval(fetchJobs, 10_000);
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [autoRefresh, fetchJobs]);

  if (authStatus === 'loading' || (loading && !data)) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <p className="text-red-500">Error: {error}</p>
      </div>
    );
  }

  if (!data) return null;

  const hasActiveJobs = data.activeVideos.length > 0;
  const summaryByType: Record<string, Record<string, number>> = {};
  for (const s of data.summary) {
    if (!summaryByType[s.jobType]) summaryByType[s.jobType] = {};
    summaryByType[s.jobType][s.status] = s.count;
  }

  const videoGroups = groupByVideo(data.logs);

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <h1 className="text-2xl font-bold">Jobs</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track transcription, clip generation, and other long-running tasks.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <Select value={jobTypeFilter} onValueChange={setJobTypeFilter}>
            <SelectTrigger className="w-[170px]">
              <SelectValue placeholder="Job type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="transcription">Transcription</SelectItem>
              <SelectItem value="speaker-transcription">Speaker ID</SelectItem>
              <SelectItem value="clip-generation">Clip Generation</SelectItem>
              <SelectItem value="download">Download</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              <SelectItem value="queued">Queued</SelectItem>
              <SelectItem value="started">In Progress</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="failed">Failed</SelectItem>
            </SelectContent>
          </Select>

          <div className="flex gap-1">
            {[1, 7, 14, 30].map((d) => (
              <button
                key={d}
                onClick={() => setDays(d)}
                className={`px-3 py-1.5 rounded text-sm transition-colors ${
                  days === d
                    ? 'bg-foreground text-background'
                    : 'bg-muted text-muted-foreground hover:bg-muted/80'
                }`}
              >
                {d}d
              </button>
            ))}
          </div>

          <Button variant="outline" size="sm" onClick={fetchJobs}>
            <RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            Refresh
          </Button>

          <button
            onClick={() => setAutoRefresh(!autoRefresh)}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              autoRefresh
                ? 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300'
                : 'bg-muted text-muted-foreground'
            }`}
            title={
              autoRefresh
                ? 'Auto-refresh every 10s (click to stop)'
                : 'Click to enable auto-refresh'
            }
          >
            {autoRefresh ? 'Live' : 'Paused'}
          </button>
        </div>
      </div>

      {/* Active jobs banner */}
      {hasActiveJobs && (
        <Card className="border-yellow-200 dark:border-yellow-800 bg-yellow-50/50 dark:bg-yellow-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin text-yellow-600" />
              In Progress ({data.activeVideos.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {data.activeVideos.map((v) => (
                <div key={v.id} className="flex items-center gap-3 text-sm">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[v.clipGenerationStatus] || ''}`}
                  >
                    {v.clipGenerationStatus}
                  </span>
                  <span className="truncate flex-1">{v.title}</span>
                  {v.feed && <span className="text-xs text-muted-foreground">{v.feed.name}</span>}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Object.entries(summaryByType).map(([jobType, statuses]) => {
          const total = Object.values(statuses).reduce((a, b) => a + b, 0);
          const failed = statuses.failed || 0;
          const completed = statuses.completed || 0;
          const active = (statuses.queued || 0) + (statuses.started || 0);
          return (
            <Card key={jobType}>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium text-muted-foreground">
                  {JOB_TYPE_LABELS[jobType] || jobType}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{total}</p>
                <div className="flex gap-2 mt-1 text-xs flex-wrap">
                  {active > 0 && (
                    <span className="text-yellow-600 dark:text-yellow-400">{active} active</span>
                  )}
                  {completed > 0 && (
                    <span className="text-green-600 dark:text-green-400">{completed} done</span>
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
                No jobs in the last {days} day{days > 1 ? 's' : ''}.
              </p>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Grouped by video */}
      {videoGroups.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-lg font-semibold">Job History</h2>
          {videoGroups.map(([videoId, { video, logs }]) => {
            const isExpanded = expandedVideoId === videoId;
            const latestStatus = logs[0]?.status;
            const jobTypes = [...new Set(logs.map((l) => l.jobType))];

            return (
              <Card key={videoId} className="overflow-hidden">
                <div
                  className="p-4 cursor-pointer hover:bg-muted/30 transition-colors"
                  onClick={() => setExpandedVideoId(isExpanded ? null : videoId)}
                >
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0">
                      {STATUS_ICON[latestStatus] || (
                        <Clock className="h-4 w-4 text-muted-foreground" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{video?.title || videoId}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        {video?.feed && (
                          <span className="text-xs text-muted-foreground">{video.feed.name}</span>
                        )}
                        {jobTypes.map((jt) => (
                          <Badge key={jt} variant="secondary" className="text-xs">
                            {JOB_TYPE_LABELS[jt] || jt}
                          </Badge>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <span className="text-xs text-muted-foreground">
                        {logs.length} event{logs.length !== 1 ? 's' : ''}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatTimeAgo(logs[0].createdAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-border/50 px-4 pb-4">
                    <div className="pt-3 space-y-2">
                      {logs.map((log) => (
                        <div
                          key={log.id}
                          className="flex items-start gap-3 text-sm py-2 border-b border-border/30 last:border-b-0"
                        >
                          <div className="flex-shrink-0 mt-0.5">{STATUS_ICON[log.status]}</div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[log.status] || ''}`}
                              >
                                {log.status}
                              </span>
                              <Badge variant="outline" className="text-xs">
                                {JOB_TYPE_LABELS[log.jobType] || log.jobType}
                              </Badge>
                              {log.durationMs !== null && (
                                <span className="text-xs font-mono text-muted-foreground">
                                  {formatDuration(log.durationMs)}
                                </span>
                              )}
                              <span className="text-xs text-muted-foreground ml-auto">
                                {formatTimeAgo(log.createdAt)}
                              </span>
                            </div>
                            {log.message && (
                              <p className="text-muted-foreground mt-1 text-xs">{log.message}</p>
                            )}
                            {log.error && (
                              <pre className="mt-1 text-xs bg-red-50 dark:bg-red-950/30 text-red-800 dark:text-red-300 p-2 rounded overflow-x-auto whitespace-pre-wrap break-all">
                                {log.error}
                              </pre>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
