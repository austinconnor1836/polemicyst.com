'use client';

import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/lib/utils';
import { Loader2, RefreshCw, Copy, Check } from 'lucide-react';

interface SpeakerSegment {
  start: number;
  end: number;
  text: string;
  speaker: string;
}

interface SpeakerTranscriptData {
  transcript: string;
  segments: SpeakerSegment[];
  speakers: string[];
}

interface SpeakerTranscriptProps {
  feedVideoId: string;
  initialData?: SpeakerTranscriptData | null;
  onSeek?: (timeSeconds: number) => void;
}

const SPEAKER_STYLES: Record<string, { bg: string; text: string; badge: string }> = {
  'Speaker 1': { bg: 'bg-blue-50 dark:bg-blue-950/30', text: 'text-blue-800 dark:text-blue-200', badge: 'bg-blue-600' },
  'Speaker 2': { bg: 'bg-green-50 dark:bg-green-950/30', text: 'text-green-800 dark:text-green-200', badge: 'bg-green-600' },
  'Speaker 3': { bg: 'bg-purple-50 dark:bg-purple-950/30', text: 'text-purple-800 dark:text-purple-200', badge: 'bg-purple-600' },
  'Speaker 4': { bg: 'bg-orange-50 dark:bg-orange-950/30', text: 'text-orange-800 dark:text-orange-200', badge: 'bg-orange-600' },
  'Speaker 5': { bg: 'bg-pink-50 dark:bg-pink-950/30', text: 'text-pink-800 dark:text-pink-200', badge: 'bg-pink-600' },
  'Speaker 6': { bg: 'bg-teal-50 dark:bg-teal-950/30', text: 'text-teal-800 dark:text-teal-200', badge: 'bg-teal-600' },
};

const DEFAULT_STYLE = { bg: 'bg-gray-50 dark:bg-gray-900/30', text: 'text-gray-800 dark:text-gray-200', badge: 'bg-gray-600' };

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

function groupBySpeaker(segments: SpeakerSegment[]) {
  if (segments.length === 0) return [];

  const groups: Array<{ speaker: string; start: number; end: number; text: string }> = [];
  let current = {
    speaker: segments[0].speaker,
    start: segments[0].start,
    end: segments[0].end,
    text: segments[0].text,
  };

  for (let i = 1; i < segments.length; i++) {
    const seg = segments[i];
    if (seg.speaker === current.speaker) {
      current.end = seg.end;
      current.text += ' ' + seg.text;
    } else {
      groups.push({ ...current });
      current = { speaker: seg.speaker, start: seg.start, end: seg.end, text: seg.text };
    }
  }
  groups.push({ ...current });

  return groups;
}

export default function SpeakerTranscript({
  feedVideoId,
  initialData,
  onSeek,
}: SpeakerTranscriptProps) {
  const [data, setData] = useState<SpeakerTranscriptData | null>(initialData ?? null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [numSpeakers, setNumSpeakers] = useState<number | ''>('');
  const [copied, setCopied] = useState(false);

  const generateTranscript = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/speaker-transcribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numSpeakers: numSpeakers || undefined }),
      });
      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Transcription failed');
      }
      if (result.alreadyTranscribed && result.data) {
        setData(result.data);
      } else if (result.enqueued) {
        setError('Speaker transcription queued. Refresh in a moment to see results.');
      } else {
        setData(result);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate transcript');
    } finally {
      setLoading(false);
    }
  }, [feedVideoId, numSpeakers]);

  const fetchExisting = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/feedVideos/${feedVideoId}/speaker-transcribe`);
      if (!res.ok) {
        if (res.status === 404) {
          setError('No speaker transcript available yet. Click "Generate" to create one.');
          return;
        }
        throw new Error('Failed to fetch transcript');
      }
      const result: SpeakerTranscriptData = await res.json();
      setData(result);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [feedVideoId]);

  const copyToClipboard = useCallback(() => {
    if (!data) return;
    const grouped = groupBySpeaker(data.segments);
    const text = grouped
      .map((g) => `[${g.speaker}] (${formatTimestamp(g.start)})\n${g.text}`)
      .join('\n\n');
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [data]);

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Speaker-Identified Transcript</CardTitle>
          <CardDescription>
            Generate a transcript that identifies who is speaking.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Speakers (optional)</Label>
              <Input
                type="number"
                min={1}
                max={20}
                value={numSpeakers}
                onChange={(e) =>
                  setNumSpeakers(e.target.value ? parseInt(e.target.value) : '')
                }
                placeholder="Auto"
                className="w-24"
              />
            </div>
            <div className="flex items-end gap-2 pt-5">
              <Button onClick={generateTranscript} disabled={loading} size="sm">
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Transcribing...
                  </>
                ) : (
                  'Generate'
                )}
              </Button>
              <Button onClick={fetchExisting} disabled={loading} variant="outline" size="sm">
                Load Existing
              </Button>
            </div>
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Speaker identification may take a few minutes for longer videos.
            </div>
          )}

          {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        </CardContent>
      </Card>
    );
  }

  const grouped = groupBySpeaker(data.segments);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base">Speaker-Identified Transcript</CardTitle>
            <CardDescription>
              {data.speakers.length} speaker{data.speakers.length !== 1 ? 's' : ''} detected
              {' \u00b7 '}
              {data.segments.length} segment{data.segments.length !== 1 ? 's' : ''}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {data.speakers.map((speaker) => {
              const style = SPEAKER_STYLES[speaker] || DEFAULT_STYLE;
              return (
                <Badge
                  key={speaker}
                  className={cn('text-white', style.badge)}
                >
                  {speaker}
                </Badge>
              );
            })}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="max-h-[360px] overflow-y-auto space-y-2 rounded-md border p-3">
          {grouped.map((group, idx) => {
            const style = SPEAKER_STYLES[group.speaker] || DEFAULT_STYLE;
            return (
              <div
                key={idx}
                className={cn('rounded-md border p-3', style.bg)}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className={cn('text-xs font-bold uppercase tracking-wide', style.text)}>
                    {group.speaker}
                  </span>
                  <button
                    onClick={() => onSeek?.(group.start)}
                    className="text-xs text-muted-foreground hover:text-foreground hover:underline cursor-pointer"
                    title="Jump to this timestamp"
                  >
                    {formatTimestamp(group.start)} - {formatTimestamp(group.end)}
                  </button>
                </div>
                <p className={cn('text-sm leading-relaxed', style.text)}>{group.text}</p>
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between pt-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setData(null)}
            className="text-xs"
          >
            <RefreshCw className="mr-1 h-3 w-3" />
            Re-generate
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyToClipboard}
            className="text-xs"
          >
            {copied ? (
              <>
                <Check className="mr-1 h-3 w-3" />
                Copied
              </>
            ) : (
              <>
                <Copy className="mr-1 h-3 w-3" />
                Copy to clipboard
              </>
            )}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
