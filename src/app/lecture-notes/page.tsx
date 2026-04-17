'use client';

import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, Copy, Download, FileText, Sigma, Type } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

type SlideNote = {
  index: number;
  timestampS: number;
  timestampLabel: string;
  title: string;
  body: string;
  rawText: string;
};

type LectureNotesResponse = {
  sourceFilename: string;
  intervalSeconds: number;
  sampledFrameCount: number;
  extractedSlideCount: number;
  durationS: number;
  notes: SlideNote[];
  outputs: {
    markdown: string;
    latex: string;
    text: string;
  };
};

type OutputFormat = 'markdown' | 'latex' | 'text';

function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function outputLabel(format: OutputFormat): string {
  if (format === 'markdown') return 'Markdown';
  if (format === 'latex') return 'LaTeX';
  return 'Plain text';
}

function outputIcon(format: OutputFormat) {
  if (format === 'markdown') return <FileText className="h-4 w-4" />;
  if (format === 'latex') return <Sigma className="h-4 w-4" />;
  return <Type className="h-4 w-4" />;
}

export default function LectureNotesPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [file, setFile] = useState<File | null>(null);
  const [intervalSeconds, setIntervalSeconds] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LectureNotesResponse | null>(null);
  const [selectedFormat, setSelectedFormat] = useState<OutputFormat>('markdown');
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'error'>('idle');

  useEffect(() => {
    if (status !== 'loading' && !session) {
      router.replace('/auth/signin');
    }
  }, [router, session, status]);

  const selectedOutput = useMemo(() => {
    if (!result) return '';
    return result.outputs[selectedFormat];
  }, [result, selectedFormat]);

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.target.files?.[0] ?? null;
    setFile(nextFile);
    setResult(null);
    setError(null);
  };

  const handleExtract = async () => {
    if (!file) {
      setError('Choose a lecture video first.');
      return;
    }

    setLoading(true);
    setError(null);
    setCopyState('idle');

    try {
      const formData = new FormData();
      formData.append('file', file);
      formData.append('intervalSeconds', String(intervalSeconds));

      const response = await fetch('/api/lecture-notes', {
        method: 'POST',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data?.error || 'Failed to extract notes from slides.');
        setResult(null);
        return;
      }
      setResult(data as LectureNotesResponse);
    } catch (requestError) {
      console.error('[lecture-notes] extract failed', requestError);
      setError('Request failed while processing lecture video.');
      setResult(null);
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!selectedOutput) return;
    try {
      await navigator.clipboard.writeText(selectedOutput);
      setCopyState('done');
      setTimeout(() => setCopyState('idle'), 1500);
    } catch (copyError) {
      console.error('[lecture-notes] copy failed', copyError);
      setCopyState('error');
      setTimeout(() => setCopyState('idle'), 1500);
    }
  };

  const handleDownload = () => {
    if (!selectedOutput || !result) return;
    const extension =
      selectedFormat === 'markdown' ? 'md' : selectedFormat === 'latex' ? 'tex' : 'txt';
    const safeBase = result.sourceFilename.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9-_]/g, '-');
    const blob = new Blob([selectedOutput], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeBase}-notes.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto max-w-6xl p-6 space-y-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold">Lecture video to Obsidian notes</h1>
        <p className="text-sm text-muted-foreground">
          Upload a lecture recording with visible slides. This extracts slide text and gives you
          Markdown, LaTeX, and plain text output for easy Obsidian paste.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>1) Upload and extract</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="lecture-video">Lecture video</Label>
              <Input id="lecture-video" type="file" accept="video/*" onChange={handleFileChange} />
              <p className="text-xs text-muted-foreground">
                Works best when slide text is large and stable on screen.
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="interval-seconds">Frame sample interval (seconds)</Label>
              <Input
                id="interval-seconds"
                type="number"
                min={2}
                max={30}
                value={intervalSeconds}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10);
                  if (!Number.isFinite(parsed)) {
                    setIntervalSeconds(8);
                    return;
                  }
                  setIntervalSeconds(Math.max(2, Math.min(30, parsed)));
                }}
              />
              <p className="text-xs text-muted-foreground">
                Lower values capture more slide transitions but process more slowly.
              </p>
            </div>
          </div>

          <Button onClick={handleExtract} disabled={loading || !file} className="gap-2">
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Upload className="h-4 w-4" />
            )}
            {loading ? 'Extracting notes...' : 'Extract notes from slides'}
          </Button>

          {file && (
            <p className="text-xs text-muted-foreground">
              Selected file: <span className="font-medium">{file.name}</span> (
              {(file.size / (1024 * 1024)).toFixed(1)} MB)
            </p>
          )}

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </div>
          )}
        </CardContent>
      </Card>

      {result && (
        <>
          <Card>
            <CardHeader>
              <CardTitle>2) Extraction summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 text-sm md:grid-cols-4">
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground">Slides captured</p>
                  <p className="text-lg font-semibold">{result.extractedSlideCount}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground">Frames sampled</p>
                  <p className="text-lg font-semibold">{result.sampledFrameCount}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground">Video duration</p>
                  <p className="text-lg font-semibold">{formatDuration(result.durationS)}</p>
                </div>
                <div className="rounded-md border p-3">
                  <p className="text-muted-foreground">Sample interval</p>
                  <p className="text-lg font-semibold">{result.intervalSeconds}s</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>3) Export for Obsidian</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex flex-wrap gap-2">
                {(['markdown', 'latex', 'text'] as OutputFormat[]).map((format) => (
                  <Button
                    key={format}
                    type="button"
                    variant={selectedFormat === format ? 'default' : 'secondary'}
                    onClick={() => setSelectedFormat(format)}
                    className="gap-2"
                  >
                    {outputIcon(format)}
                    {outputLabel(format)}
                  </Button>
                ))}
              </div>

              <div className="flex gap-2">
                <Button type="button" variant="secondary" onClick={handleCopy} className="gap-2">
                  <Copy className="h-4 w-4" />
                  {copyState === 'done'
                    ? 'Copied'
                    : copyState === 'error'
                      ? 'Copy failed'
                      : 'Copy output'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={handleDownload}
                  className="gap-2"
                >
                  <Download className="h-4 w-4" />
                  Download file
                </Button>
              </div>

              <textarea
                readOnly
                value={selectedOutput}
                className="h-[380px] w-full rounded-md border bg-background p-3 font-mono text-xs"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>4) Slide-by-slide preview</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {result.notes.map((note) => (
                <div key={`${note.index}-${note.timestampS}`} className="rounded-md border p-3">
                  <p className="font-medium">
                    {note.index}. {note.title}
                  </p>
                  <p className="text-xs text-muted-foreground mb-2">{note.timestampLabel}</p>
                  <p className="text-sm whitespace-pre-wrap">{note.body}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
