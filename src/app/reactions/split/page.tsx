'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { ArrowLeft, Scissors, Loader2, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { VideoUploader, type UploadStatus } from '@/app/reactions/_components/VideoUploader';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface BoundaryWindow {
  startS: number;
  endS: number;
  durationS: number;
  overLimit: boolean;
}

interface CaptureTemplate {
  id: string;
  name: string;
  canvasWidth: number;
  canvasHeight: number;
  creatorRect: Rect;
  referenceRect: Rect;
  referenceOrientation: 'portrait' | 'landscape';
}

function fmt(t: number): string {
  const mm = Math.floor(t / 60);
  const ss = (t % 60).toFixed(1).padStart(4, '0');
  return `${mm}:${ss}`;
}

/** Numeric x/y/w/h editor for one crop rectangle. */
function RectEditor({
  label,
  color,
  rect,
  onChange,
}: {
  label: string;
  color: string;
  rect: Rect;
  onChange: (r: Rect) => void;
}) {
  const field = (key: keyof Rect) => (
    <div className="flex flex-col gap-1">
      <span className="text-xs uppercase text-muted-foreground">{key}</span>
      <Input
        type="number"
        value={Number.isFinite(rect[key]) ? rect[key] : 0}
        onChange={(e) => onChange({ ...rect, [key]: Math.round(Number(e.target.value)) })}
      />
    </div>
  );
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="inline-block h-3 w-3 rounded-sm" style={{ backgroundColor: color }} />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="grid grid-cols-4 gap-2">
        {field('x')}
        {field('y')}
        {field('w')}
        {field('h')}
      </div>
    </div>
  );
}

export default function CaptureSplitterPage() {
  const router = useRouter();

  // Upload state
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [s3Key, setS3Key] = useState<string | null>(null);
  const [s3Url, setS3Url] = useState<string | null>(null);
  const [uploadStatus, setUploadStatus] = useState<UploadStatus>('idle');
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [capture, setCapture] = useState<{
    width: number;
    height: number;
    durationS: number;
  } | null>(null);

  // Layout
  const [creatorRect, setCreatorRect] = useState<Rect>({ x: 0, y: 0, w: 960, h: 1080 });
  const [referenceRect, setReferenceRect] = useState<Rect>({ x: 960, y: 0, w: 960, h: 1080 });
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('portrait');
  const [templates, setTemplates] = useState<CaptureTemplate[]>([]);

  // Detection params + results
  const [threshold, setThreshold] = useState(0.4);
  const [minSegment, setMinSegment] = useState(8);
  const [detecting, setDetecting] = useState(false);
  const [boundaries, setBoundaries] = useState<BoundaryWindow[] | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetch('/api/capture-templates')
      .then((r) => (r.ok ? r.json() : []))
      .then((data: CaptureTemplate[]) => setTemplates(Array.isArray(data) ? data : []))
      .catch(() => {});
  }, []);

  // Default the rects to left/right halves once we know the capture dimensions.
  const onFileSelected = useCallback(
    (data: { blobUrl: string; durationS: number; width: number; height: number }) => {
      setBlobUrl(data.blobUrl);
      setCapture({ width: data.width, height: data.height, durationS: data.durationS });
      const half = Math.round(data.width / 2);
      setCreatorRect({ x: 0, y: 0, w: half, h: data.height });
      setReferenceRect({ x: half, y: 0, w: data.width - half, h: data.height });
      setBoundaries(null);
    },
    []
  );

  const applyTemplate = useCallback((t: CaptureTemplate) => {
    setCreatorRect(t.creatorRect);
    setReferenceRect(t.referenceRect);
    setOrientation(t.referenceOrientation);
    toast.success(`Applied layout "${t.name}"`);
  }, []);

  const saveTemplate = useCallback(async () => {
    if (!capture) return;
    const name = window.prompt('Name this layout:');
    if (!name) return;
    try {
      const res = await fetch('/api/capture-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          canvasWidth: capture.width,
          canvasHeight: capture.height,
          creatorRect,
          referenceRect,
          referenceOrientation: orientation,
        }),
      });
      if (!res.ok) throw new Error();
      const t = await res.json();
      setTemplates((prev) => [t, ...prev]);
      toast.success('Layout saved');
    } catch {
      toast.error('Failed to save layout');
    }
  }, [capture, creatorRect, referenceRect, orientation]);

  const detect = useCallback(async () => {
    if (!s3Url) {
      toast.error('Upload a capture first');
      return;
    }
    setDetecting(true);
    setBoundaries(null);
    try {
      const res = await fetch('/api/reaction-sessions/detect-boundaries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureS3Url: s3Url,
          referenceRect,
          threshold,
          minSegmentS: minSegment,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Detection failed');
      setBoundaries(data.boundaries);
      toast.success(`Found ${data.boundaries.length} reaction(s)`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Detection failed');
    } finally {
      setDetecting(false);
    }
  }, [s3Url, referenceRect, threshold, minSegment]);

  const createShorts = useCallback(async () => {
    if (!s3Key || !boundaries || boundaries.length === 0) return;
    setCreating(true);
    try {
      const res = await fetch('/api/reaction-sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          captureS3Key: s3Key,
          captureDurationS: capture?.durationS,
          creatorRect,
          referenceRect,
          referenceOrientation: orientation,
          boundaries: boundaries.map((b) => ({
            startS: b.startS,
            endS: b.endS,
            overLimit: b.overLimit,
          })),
          render: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create');
      toast.success(`Rendering ${data.compositions.length} short(s)`);
      router.push('/reactions');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create');
    } finally {
      setCreating(false);
    }
  }, [s3Key, boundaries, capture, creatorRect, referenceRect, orientation, router]);

  // Overlay boxes positioned as % of the capture canvas.
  const overlay = useMemo(() => {
    if (!capture) return null;
    const box = (rect: Rect, color: string, label: string) => (
      <div
        className="absolute flex items-start justify-start border-2 text-[10px] font-bold"
        style={{
          left: `${(rect.x / capture.width) * 100}%`,
          top: `${(rect.y / capture.height) * 100}%`,
          width: `${(rect.w / capture.width) * 100}%`,
          height: `${(rect.h / capture.height) * 100}%`,
          borderColor: color,
          color,
          backgroundColor: `${color}22`,
        }}
      >
        <span className="px-1" style={{ backgroundColor: color, color: '#000' }}>
          {label}
        </span>
      </div>
    );
    return (
      <>
        {box(creatorRect, '#38bdf8', 'creator')}
        {box(referenceRect, '#f59e0b', 'reference')}
      </>
    );
  }, [capture, creatorRect, referenceRect]);

  return (
    <div className="mx-auto max-w-5xl space-y-6 p-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/reactions">
            <ArrowLeft className="mr-1 h-4 w-4" /> Reactions
          </Link>
        </Button>
        <h1 className="flex items-center gap-2 text-2xl font-bold">
          <Scissors className="h-6 w-6" /> Reaction Capture Splitter
        </h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Upload one long screen recording of your reactions (your feed beside the reference videos).
        Mark where each feed sits, detect the reaction boundaries, and fan the recording out into
        one mobile + landscape short per reaction.
      </p>

      {/* Step 1 — Upload */}
      <Card>
        <CardHeader>
          <CardTitle>1. Upload capture</CardTitle>
          <CardDescription>The full multi-reaction screen recording.</CardDescription>
        </CardHeader>
        <CardContent>
          <VideoUploader
            label="Capture"
            keyPrefix="captures"
            blobUrl={blobUrl}
            s3Key={s3Key}
            s3Url={s3Url}
            uploadStatus={uploadStatus}
            uploadProgress={uploadProgress}
            onFileSelected={onFileSelected}
            onUploadProgress={(p) => setUploadProgress(p)}
            onUploadComplete={({ s3Key: k, s3Url: u }) => {
              setS3Key(k);
              setS3Url(u);
              setUploadStatus('complete');
              toast.success('Capture uploaded');
            }}
            onUploadError={(e) => {
              setUploadStatus('error');
              toast.error(e || 'Upload failed');
            }}
            onRemove={() => {
              setS3Key(null);
              setS3Url(null);
              setBlobUrl(null);
              setCapture(null);
              setBoundaries(null);
              setUploadStatus('idle');
            }}
          />
        </CardContent>
      </Card>

      {/* Step 2 — Layout */}
      {capture && (
        <Card>
          <CardHeader>
            <CardTitle>2. Mark the feeds</CardTitle>
            <CardDescription>
              Capture is {capture.width}×{capture.height}. Set the creator and reference rectangles
              (pixels). Save it as a reusable layout if your on-screen setup is fixed.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {blobUrl && (
              <div className="relative mx-auto max-w-2xl overflow-hidden rounded-md border bg-black">
                {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
                <video src={blobUrl} className="w-full" muted />
                {overlay}
              </div>
            )}

            {templates.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-muted-foreground">Saved layouts:</span>
                {templates.map((t) => (
                  <Button key={t.id} variant="outline" size="sm" onClick={() => applyTemplate(t)}>
                    {t.name}
                  </Button>
                ))}
              </div>
            )}

            <div className="grid gap-4 sm:grid-cols-2">
              <RectEditor
                label="Creator feed"
                color="#38bdf8"
                rect={creatorRect}
                onChange={setCreatorRect}
              />
              <RectEditor
                label="Reference feed"
                color="#f59e0b"
                rect={referenceRect}
                onChange={setReferenceRect}
              />
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm">Reference orientation:</span>
              {(['portrait', 'landscape'] as const).map((o) => (
                <Button
                  key={o}
                  variant={orientation === o ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setOrientation(o)}
                >
                  {o}
                </Button>
              ))}
              <div className="flex-1" />
              <Button variant="outline" size="sm" onClick={saveTemplate}>
                Save as layout
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3 — Detect */}
      {s3Url && capture && (
        <Card>
          <CardHeader>
            <CardTitle>3. Detect reactions</CardTitle>
            <CardDescription>
              Scene-cut detection over the reference region. If it over/under-splits, adjust the
              threshold (lower = more sensitive) or the minimum reaction length, then re-detect.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-muted-foreground">Threshold (0–1)</span>
                <Input
                  type="number"
                  step="0.05"
                  min="0.05"
                  max="0.95"
                  value={threshold}
                  onChange={(e) => setThreshold(Number(e.target.value))}
                  className="w-32"
                />
              </div>
              <div className="flex flex-col gap-1">
                <span className="text-xs uppercase text-muted-foreground">Min reaction (s)</span>
                <Input
                  type="number"
                  min="1"
                  value={minSegment}
                  onChange={(e) => setMinSegment(Number(e.target.value))}
                  className="w-32"
                />
              </div>
              <Button onClick={detect} disabled={detecting}>
                {detecting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Detecting…
                  </>
                ) : (
                  <>
                    <Wand2 className="mr-2 h-4 w-4" /> Detect boundaries
                  </>
                )}
              </Button>
            </div>

            {boundaries && (
              <div className="space-y-2">
                <div className="text-sm font-medium">{boundaries.length} reaction window(s)</div>
                <div className="divide-y rounded-md border">
                  {boundaries.map((b, i) => (
                    <div key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="w-6 text-muted-foreground">{i + 1}</span>
                      <span className="font-mono">
                        {fmt(b.startS)} → {fmt(b.endS)}
                      </span>
                      <span className="text-muted-foreground">({b.durationS.toFixed(1)}s)</span>
                      {b.overLimit && <Badge variant="destructive">over 90s</Badge>}
                    </div>
                  ))}
                </div>
                {boundaries.some((b) => b.overLimit) && (
                  <p className="text-xs text-muted-foreground">
                    Windows over 90s exceed the Shorts/Reels limit — they’ll still render, but trim
                    them in the editor afterward (auto best-window selection is a follow-up).
                  </p>
                )}
                <Button onClick={createShorts} disabled={creating} className="mt-2">
                  {creating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      <Scissors className="mr-2 h-4 w-4" /> Create {boundaries.length} short(s)
                    </>
                  )}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
