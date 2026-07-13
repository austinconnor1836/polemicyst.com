'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { ExternalLink, Loader2, Scissors, Search } from 'lucide-react';
import toast from 'react-hot-toast';

interface ApiHit {
  hitId: string;
  feedVideoId: string;
  videoTitle: string;
  channel: string | null;
  thumbnailUrl: string | null;
  youtubeVideoId: string | null;
  startSec: number;
  endSec: number | null;
  matchText: string;
  matchedSpan: string;
  deepLinkUrl: string | null;
}

interface GroupedVideo {
  feedVideoId: string;
  videoTitle: string;
  channel: string | null;
  thumbnailUrl: string | null;
  youtubeVideoId: string | null;
  hits: ApiHit[];
}

interface SearchResponse {
  query: { id: string; queryText: string; wordBoundary: boolean; isRegex: boolean };
  videos: GroupedVideo[];
  totalHits: number;
  scannedVideos: number;
  scannedSegments: number;
  truncated: boolean;
}

function formatTimestamp(sec: number): string {
  const s = Math.floor(Math.max(0, sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(ss)}` : `${m}:${pad(ss)}`;
}

/**
 * Highlight the `matchedSpan` inside `matchText`. Case-insensitive substring
 * search — for regex-mode hits we still fall back to a plain-text find of the
 * exact captured span (the server already produced the exact span it matched),
 * so this is safe.
 */
function HighlightedSnippet({ text, span }: { text: string; span: string }) {
  if (!span) return <>{text}</>;
  const idx = text.toLowerCase().indexOf(span.toLowerCase());
  if (idx < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, idx)}
      <mark className="rounded bg-yellow-200 px-0.5 font-semibold text-yellow-950 dark:bg-yellow-500/40 dark:text-yellow-50">
        {text.slice(idx, idx + span.length)}
      </mark>
      {text.slice(idx + span.length)}
    </>
  );
}

export default function SearchTranscriptsPage() {
  const [query, setQuery] = useState('');
  const [wordBoundary, setWordBoundary] = useState(false);
  const [searching, setSearching] = useState(false);
  const [result, setResult] = useState<SearchResponse | null>(null);
  const [pendingHitId, setPendingHitId] = useState<string | null>(null);

  const handleSearch = useCallback(
    async (e?: React.FormEvent) => {
      e?.preventDefault();
      const trimmed = query.trim();
      if (!trimmed) {
        toast.error('Enter a phrase to search');
        return;
      }
      setSearching(true);
      try {
        const res = await fetch('/api/transcript-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: trimmed, wordBoundary }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body?.error || `Search failed (${res.status})`);
        }
        const data = (await res.json()) as SearchResponse;
        setResult(data);
        if (data.totalHits === 0) {
          toast('No matches found', { icon: '\u{1F50D}' });
        } else if (data.truncated) {
          toast(`Scan capped at ${data.scannedSegments} segments`, { icon: '⚠️' });
        }
      } catch (err: any) {
        toast.error(err?.message || 'Search failed');
      } finally {
        setSearching(false);
      }
    },
    [query, wordBoundary]
  );

  const handleGenerateClip = useCallback(async (hitId: string) => {
    setPendingHitId(hitId);
    try {
      const res = await fetch('/api/transcript-search/generate-clip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hitId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Enqueue failed (${res.status})`);
      }
      const data = await res.json();
      if (data.status === 'already_running') {
        toast('Clip generation already running for this video', { icon: '⏳' });
      } else {
        toast.success('Clip generation queued');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Failed to queue clip generation');
    } finally {
      setPendingHitId(null);
    }
  }, []);

  const hasSearched = result !== null;
  const totalHits = result?.totalHits ?? 0;

  const summary = useMemo(() => {
    if (!result) return null;
    const parts: string[] = [];
    parts.push(`${result.totalHits} match${result.totalHits === 1 ? '' : 'es'}`);
    parts.push(`across ${result.videos.length} video${result.videos.length === 1 ? '' : 's'}`);
    parts.push(
      `(scanned ${result.scannedVideos} video${result.scannedVideos === 1 ? '' : 's'}, ${result.scannedSegments} segments${result.truncated ? ', truncated' : ''})`
    );
    return parts.join(' ');
  }, [result]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-2xl font-bold">Search transcripts</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Full-text search across every transcript in your library. Jump to the moment on YouTube or
          generate a clip right there.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Query</CardTitle>
          <CardDescription>
            Plain text or regex — case-insensitive. Toggle whole-word to match{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">rent</code> but not{' '}
            <code className="rounded bg-muted px-1 py-0.5 text-xs">apprentice</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSearch} className="space-y-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="e.g. housing crisis"
                disabled={searching}
                className="flex-1"
                aria-label="Search phrase"
              />
              <Button type="submit" disabled={searching || !query.trim()} className="sm:w-auto">
                {searching ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                    Searching
                  </>
                ) : (
                  <>
                    <Search className="mr-2 h-4 w-4" aria-hidden="true" />
                    Search
                  </>
                )}
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <Switch
                id="word-boundary"
                checked={wordBoundary}
                onCheckedChange={setWordBoundary}
                disabled={searching}
              />
              <Label htmlFor="word-boundary" className="cursor-pointer text-sm">
                Whole word only
              </Label>
            </div>
          </form>
        </CardContent>
      </Card>

      {hasSearched && totalHits === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center">
            <p className="text-lg font-medium text-muted-foreground">No matches</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a shorter phrase, disable whole-word, or import more videos.
            </p>
          </CardContent>
        </Card>
      )}

      {hasSearched && totalHits > 0 && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <CardTitle>Results</CardTitle>
                <CardDescription>{summary}</CardDescription>
              </div>
              {result?.query.isRegex && <Badge variant="secondary">regex</Badge>}
            </div>
          </CardHeader>
          <CardContent className="space-y-6">
            {result!.videos.map((v) => (
              <div key={v.feedVideoId} className="space-y-3">
                <div className="flex flex-col gap-1 border-b border-border pb-2 sm:flex-row sm:items-baseline sm:justify-between">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <Link
                      href={`/details/${v.feedVideoId}`}
                      className="text-base font-semibold hover:underline"
                    >
                      {v.videoTitle}
                    </Link>
                    {v.channel && (
                      <span className="text-sm text-muted-foreground">— {v.channel}</span>
                    )}
                  </div>
                  <Badge variant="outline" className="w-fit">
                    {v.hits.length} hit{v.hits.length === 1 ? '' : 's'}
                  </Badge>
                </div>

                <ul className="space-y-3">
                  {v.hits.map((h) => (
                    <li
                      key={h.hitId || `${h.feedVideoId}-${h.startSec}`}
                      className="flex flex-col gap-2 rounded-md border border-border bg-surface p-3 sm:flex-row sm:items-start sm:gap-4"
                    >
                      <div className="min-w-[60px] font-mono text-sm text-muted-foreground">
                        {formatTimestamp(h.startSec)}
                      </div>
                      <div className="flex-1 space-y-2">
                        <p className="text-sm leading-relaxed">
                          <HighlightedSnippet text={h.matchText} span={h.matchedSpan} />
                        </p>
                        <div className="flex flex-wrap items-center gap-2">
                          {h.deepLinkUrl && (
                            <Button asChild variant="outline" size="sm">
                              <a href={h.deepLinkUrl} target="_blank" rel="noopener noreferrer">
                                <ExternalLink className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                Open on YouTube
                              </a>
                            </Button>
                          )}
                          <Button
                            variant="default"
                            size="sm"
                            onClick={() => handleGenerateClip(h.hitId)}
                            disabled={!h.hitId || pendingHitId === h.hitId}
                          >
                            {pendingHitId === h.hitId ? (
                              <>
                                <Loader2
                                  className="mr-1.5 h-3.5 w-3.5 animate-spin"
                                  aria-hidden="true"
                                />
                                Queuing
                              </>
                            ) : (
                              <>
                                <Scissors className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
                                Generate clip here
                              </>
                            )}
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
