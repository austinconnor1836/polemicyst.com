'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent } from 'react';
import { useParams, useRouter } from 'next/navigation';
import AspectRatioSelect, { type AspectRatio } from '@/components/AspectRatioSelect';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import {
  ArrowLeft,
  Download,
  Loader2,
  PauseCircle,
  PlayCircle,
  Save,
  Sparkles,
} from 'lucide-react';
import { formatRelativeTime } from '@/app/feeds/util/time';

type ClipRecord = {
  id: string;
  videoTitle?: string | null;
  sharedDescription?: string | null;
  s3Url?: string | null;
  s3Key?: string | null;
  createdAt?: string | null;
};

type FeedVideoSummary = {
  feedVideo: {
    id: string;
    title: string;
    s3Url: string;
    thumbnailUrl?: string | null;
  };
  clips: ClipRecord[];
};

type CropRect = {
  x: number;
  y: number;
  w: number;
  h: number;
};

type CropTemplate = {
  id: string;
  name: string;
  aspectRatio: string;
  cropX: number;
  cropY: number;
  cropWidth: number;
  cropHeight: number;
  isDefault: boolean;
};

type DragState =
  | {
      mode: 'move';
      startX: number;
      startY: number;
      startCrop: CropRect;
    }
  | {
      mode: 'resize';
      handle: 'nw' | 'ne' | 'sw' | 'se';
      startX: number;
      startY: number;
      startCrop: CropRect;
    };

type TextOverlay = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
};

const DEFAULT_CROP: CropRect = { x: 0.1, y: 0.08, w: 0.8, h: 0.84 };

export default function ClipEditorPage() {
  const params = useParams<{ feedVideoId: string; clipId: string }>();
  const router = useRouter();
  const feedVideoId = params.feedVideoId;
  const clipId = params.clipId;

  const [summary, setSummary] = useState<FeedVideoSummary | null>(null);
  const [clip, setClip] = useState<ClipRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [aspectRatio, setAspectRatio] = useState<AspectRatio>('9:16');
  const [clipTitle, setClipTitle] = useState('');
  const [description, setDescription] = useState('');
  const [captionStyle, setCaptionStyle] = useState('pop');
  const [autoCaptions, setAutoCaptions] = useState(true);
  const [safeZone, setSafeZone] = useState(true);
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [cropMode, setCropMode] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(true);
  const [crop, setCrop] = useState<CropRect>(DEFAULT_CROP);
  const [templates, setTemplates] = useState<CropTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(false);
  const [templateName, setTemplateName] = useState('');
  const [templateMessage, setTemplateMessage] = useState<string | null>(null);
  const [textOverlays, setTextOverlays] = useState<TextOverlay[]>([]);
  const [selectedOverlayId, setSelectedOverlayId] = useState<string | null>(null);

  const previewRef = useRef<HTMLDivElement | null>(null);
  const dragStateRef = useRef<DragState | null>(null);
  const textDragRef = useRef<{
    id: string;
    startX: number;
    startY: number;
    startPos: { x: number; y: number };
  } | null>(null);

  const fetchSummary = useCallback(
    async (options?: { silent?: boolean }) => {
      if (!feedVideoId) return;
      if (!options?.silent) {
        setLoading(true);
        setPageError(null);
      } else {
        setRefreshing(true);
      }
      try {
        const res = await fetch(`/api/feedVideos/${feedVideoId}/clips`, { cache: 'no-store' });
        if (!res.ok) throw new Error('Failed to load clip data');
        const data = (await res.json()) as FeedVideoSummary;
        const foundClip = data.clips.find((item) => item.id === clipId) ?? null;
        setSummary(data);
        setClip(foundClip);
        if (!foundClip) {
          setPageError('Clip not found for this video.');
        }
      } catch (err) {
        console.error(err);
        setPageError('Could not load this clip. Try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [feedVideoId, clipId]
  );

  useEffect(() => {
    fetchSummary();
  }, [fetchSummary]);

  useEffect(() => {
    if (!clip) return;
    setClipTitle(clip.videoTitle?.trim() || 'Untitled clip');
    setDescription(clip.sharedDescription?.trim() || '');
  }, [clip]);

  useEffect(() => {
    if (!saveMessage) return;
    const timeout = window.setTimeout(() => setSaveMessage(null), 2400);
    return () => window.clearTimeout(timeout);
  }, [saveMessage]);

  const fetchTemplates = useCallback(async () => {
    setTemplatesLoading(true);
    try {
      const res = await fetch('/api/clip-templates', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to load templates');
      const data = (await res.json()) as CropTemplate[];
      setTemplates(data);
    } catch (err) {
      console.error(err);
      setTemplateMessage('Failed to load templates.');
    } finally {
      setTemplatesLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  useEffect(() => {
    if (!templateMessage) return;
    const timeout = window.setTimeout(() => setTemplateMessage(null), 2600);
    return () => window.clearTimeout(timeout);
  }, [templateMessage]);

  const clampCrop = useCallback((next: CropRect) => {
    const width = Math.min(1, Math.max(0.08, next.w));
    const height = Math.min(1, Math.max(0.08, next.h));
    const x = Math.min(1 - width, Math.max(0, next.x));
    const y = Math.min(1 - height, Math.max(0, next.y));
    return { x, y, w: width, h: height };
  }, []);

  const updateCrop = useCallback(
    (next: CropRect) => {
      setCrop(clampCrop(next));
    },
    [clampCrop]
  );

  const handlePointerDown = useCallback(
    (event: PointerEvent, mode: DragState['mode'], handle?: DragState['handle']) => {
      if (!previewRef.current) return;
      if (!cropMode) return;
      event.preventDefault();
      const { clientX, clientY } = event;
      const startCrop = { ...crop };
      dragStateRef.current =
        mode === 'move'
          ? { mode, startX: clientX, startY: clientY, startCrop }
          : { mode, handle: handle || 'se', startX: clientX, startY: clientY, startCrop };
    },
    [crop, cropMode]
  );

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (textDragRef.current && previewRef.current) {
        const state = textDragRef.current;
        const rect = previewRef.current.getBoundingClientRect();
        if (rect.width && rect.height) {
          const dx = (event.clientX - state.startX) / rect.width;
          const dy = (event.clientY - state.startY) / rect.height;
          setTextOverlays((prev) =>
            prev.map((overlay) =>
              overlay.id === state.id
                ? {
                    ...overlay,
                    x: Math.min(1, Math.max(0, state.startPos.x + dx)),
                    y: Math.min(1, Math.max(0, state.startPos.y + dy)),
                  }
                : overlay
            )
          );
        }
        return;
      }
      const state = dragStateRef.current;
      if (!state || !previewRef.current) return;
      const rect = previewRef.current.getBoundingClientRect();
      if (!rect.width || !rect.height) return;

      const dx = (event.clientX - state.startX) / rect.width;
      const dy = (event.clientY - state.startY) / rect.height;

      if (state.mode === 'move') {
        updateCrop({
          x: state.startCrop.x + dx,
          y: state.startCrop.y + dy,
          w: state.startCrop.w,
          h: state.startCrop.h,
        });
        return;
      }

      const next = { ...state.startCrop };
      if (state.handle.includes('e')) {
        next.w = state.startCrop.w + dx;
      }
      if (state.handle.includes('s')) {
        next.h = state.startCrop.h + dy;
      }
      if (state.handle.includes('w')) {
        next.x = state.startCrop.x + dx;
        next.w = state.startCrop.w - dx;
      }
      if (state.handle.includes('n')) {
        next.y = state.startCrop.y + dy;
        next.h = state.startCrop.h - dy;
      }
      updateCrop(next);
    };

    const handlePointerUp = () => {
      dragStateRef.current = null;
      textDragRef.current = null;
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [updateCrop]);

  const addTextOverlay = () => {
    const id = `overlay-${Date.now()}`;
    const next: TextOverlay = {
      id,
      text: 'New text',
      x: 0.5,
      y: 0.15,
      size: 28,
      color: '#ffffff',
    };
    setTextOverlays((prev) => [next, ...prev]);
    setSelectedOverlayId(id);
  };

  const selectedOverlay = useMemo(
    () => textOverlays.find((overlay) => overlay.id === selectedOverlayId) || null,
    [textOverlays, selectedOverlayId]
  );

  const updateOverlay = (id: string, patch: Partial<TextOverlay>) => {
    setTextOverlays((prev) =>
      prev.map((overlay) => (overlay.id === id ? { ...overlay, ...patch } : overlay))
    );
  };

  const removeOverlay = (id: string) => {
    setTextOverlays((prev) => prev.filter((overlay) => overlay.id !== id));
    setSelectedOverlayId((current) => (current === id ? null : current));
  };

  const handleApplyTemplate = (template: CropTemplate) => {
    setAspectRatio((template.aspectRatio as AspectRatio) || '9:16');
    setCrop({
      x: template.cropX,
      y: template.cropY,
      w: template.cropWidth,
      h: template.cropHeight,
    });
  };

  const handleSaveTemplate = async () => {
    const name = templateName.trim();
    if (!name) {
      setTemplateMessage('Enter a template name.');
      return;
    }
    try {
      const res = await fetch('/api/clip-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          aspectRatio,
          cropX: crop.x,
          cropY: crop.y,
          cropWidth: crop.w,
          cropHeight: crop.h,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setTemplateMessage(data?.error || 'Failed to save template.');
        return;
      }
      setTemplates((prev) => [data, ...prev]);
      setTemplateName('');
      setTemplateMessage('Template saved.');
    } catch (err) {
      console.error(err);
      setTemplateMessage('Failed to save template.');
    }
  };

  const clipLabel = useMemo(() => {
    if (!clip) return 'Clip editor';
    return clip.videoTitle?.trim() || 'Generated clip';
  }, [clip]);

  return (
    <div className="mx-auto w-full max-w-[2200px] px-4 py-6 sm:px-6 lg:px-8 lg:h-[calc(100vh-var(--navbar-height))] lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0 lg:pb-52">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" onClick={() => router.push(`/clips/${feedVideoId}`)}>
          <ArrowLeft className="mr-2 h-4 w-4" />
          Back to clip list
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fetchSummary({ silent: true })}
          disabled={refreshing}
        >
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </Button>
        {clip?.createdAt ? (
          <Badge variant="outline">Created {formatRelativeTime(clip.createdAt)}</Badge>
        ) : null}
      </div>

      {loading ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <div className="text-sm text-muted-foreground">Loading editor...</div>
          </CardContent>
        </Card>
      ) : pageError || !clip ? (
        <Card className="border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20">
          <CardContent className="flex flex-col gap-3 p-5 text-sm text-red-800 dark:text-red-200">
            <div>{pageError || 'Clip not found.'}</div>
            <Button variant="secondary" size="sm" onClick={() => fetchSummary()} className="w-fit">
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6 lg:flex-1 lg:overflow-hidden lg:min-h-0">
          <Card>
            <CardHeader className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge>Editing</Badge>
                <Badge variant="secondary">Opus-style editor</Badge>
                {summary?.feedVideo?.title ? (
                  <Badge variant="outline">Source: {summary.feedVideo.title}</Badge>
                ) : null}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-2xl font-semibold">{clipLabel}</CardTitle>
                  <CardDescription>
                    Refine the clip, captions, and layout before exporting.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    onClick={() => setSaveMessage('Draft saved locally.')}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save draft
                  </Button>
                  {clip.s3Url ? (
                    <Button asChild>
                      <a href={clip.s3Url} download>
                        <Download className="mr-2 h-4 w-4" />
                        Export video
                      </a>
                    </Button>
                  ) : (
                    <Button disabled>Export video</Button>
                  )}
                </div>
              </div>
              {saveMessage ? (
                <div className="text-xs text-muted-foreground">{saveMessage}</div>
              ) : null}
            </CardHeader>
          </Card>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_560px] lg:flex-1 lg:overflow-hidden lg:min-h-0 lg:h-full">
            <div className="space-y-2 lg:overflow-y-auto lg:pr-2 lg:min-h-0 lg:h-full">
              <Card className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-base">Preview</CardTitle>
                  <CardDescription>
                    Adjust framing, safe areas, and caption placement in real time.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-1">
                  <div
                    ref={previewRef}
                    className="relative mx-auto w-full max-w-[260px] overflow-hidden rounded-2xl border bg-black"
                    style={{
                      aspectRatio:
                        aspectRatio === '9:16'
                          ? '9 / 16'
                          : aspectRatio === '16:9'
                            ? '16 / 9'
                            : '1 / 1',
                    }}
                  >
                    <video
                      src={clip.s3Url || undefined}
                      poster={summary?.feedVideo?.thumbnailUrl || undefined}
                      controls
                      preload="metadata"
                      playsInline
                      className="absolute inset-0 h-full w-full bg-black object-cover"
                    />
                    {textOverlays.map((overlay) => (
                      <div
                        key={overlay.id}
                        role="button"
                        tabIndex={0}
                        className={cn(
                          'absolute select-none rounded px-2 py-1 text-center font-semibold shadow-sm',
                          selectedOverlayId === overlay.id
                            ? 'ring-2 ring-white/80'
                            : 'ring-1 ring-white/30'
                        )}
                        style={{
                          left: `${overlay.x * 100}%`,
                          top: `${overlay.y * 100}%`,
                          transform: 'translate(-50%, -50%)',
                          fontSize: `${overlay.size}px`,
                          color: overlay.color,
                          background: 'rgba(0,0,0,0.35)',
                          cursor: 'move',
                        }}
                        onPointerDown={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setSelectedOverlayId(overlay.id);
                          if (!previewRef.current) return;
                          textDragRef.current = {
                            id: overlay.id,
                            startX: event.clientX,
                            startY: event.clientY,
                            startPos: { x: overlay.x, y: overlay.y },
                          };
                        }}
                      >
                        {overlay.text}
                      </div>
                    ))}
                    {cropMode ? (
                      <>
                        <div className="pointer-events-none absolute inset-0">
                          <div
                            className="absolute border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]"
                            style={{
                              left: `${crop.x * 100}%`,
                              top: `${crop.y * 100}%`,
                              width: `${crop.w * 100}%`,
                              height: `${crop.h * 100}%`,
                            }}
                          />
                        </div>
                        <div
                          className="absolute border border-white/60 bg-white/5"
                          style={{
                            left: `${crop.x * 100}%`,
                            top: `${crop.y * 100}%`,
                            width: `${crop.w * 100}%`,
                            height: `${crop.h * 100}%`,
                            cursor: 'grab',
                          }}
                          onPointerDown={(event) => handlePointerDown(event, 'move')}
                        >
                          {(['nw', 'ne', 'sw', 'se'] as const).map((handle) => (
                            <button
                              key={handle}
                              type="button"
                              className={cn(
                                'absolute h-3.5 w-3.5 rounded-full border border-white bg-black/70',
                                handle === 'nw' && '-left-1.5 -top-1.5 cursor-nwse-resize',
                                handle === 'ne' && '-right-1.5 -top-1.5 cursor-nesw-resize',
                                handle === 'sw' && '-bottom-1.5 -left-1.5 cursor-nesw-resize',
                                handle === 'se' && '-bottom-1.5 -right-1.5 cursor-nwse-resize'
                              )}
                              onPointerDown={(event) => {
                                event.stopPropagation();
                                handlePointerDown(event, 'resize', handle);
                              }}
                            />
                          ))}
                        </div>
                      </>
                    ) : null}
                    {safeZone ? (
                      <>
                        <div className="pointer-events-none absolute inset-8 rounded-xl border border-white/30" />
                        <div className="pointer-events-none absolute inset-4 rounded-lg border border-white/10" />
                      </>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Sparkles className="h-4 w-4" />
                      {cropMode
                        ? 'Drag to crop and resize the frame.'
                        : 'Enable crop mode to adjust framing.'}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setIsPlaying((prev) => !prev)}
                    >
                      {isPlaying ? (
                        <>
                          <PauseCircle className="mr-2 h-4 w-4" />
                          Pause
                        </>
                      ) : (
                        <>
                          <PlayCircle className="mr-2 h-4 w-4" />
                          Play
                        </>
                      )}
                    </Button>
                  </div>
                </CardContent>
              </Card>

            </div>

            <div className="space-y-2 lg:overflow-y-auto lg:pr-1 lg:min-h-0 lg:h-full">
              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Clip details</CardTitle>
                  <CardDescription>Metadata shown on social exports.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="clip-title">Title</Label>
                    <Input
                      id="clip-title"
                      value={clipTitle}
                      onChange={(event) => setClipTitle(event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="clip-description">Description</Label>
                    <Textarea
                      id="clip-description"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Add a short description or hook."
                    />
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Layout</CardTitle>
                  <CardDescription>Aspect ratio and safe area guides.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <AspectRatioSelect value={aspectRatio} onChange={setAspectRatio} />
                  <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border bg-muted/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Crop mode</p>
                      <p className="text-xs text-muted-foreground">
                        Toggle the crop box on the preview.
                      </p>
                    </div>
                    <Button
                      size="sm"
                      variant={cropMode ? 'secondary' : 'outline'}
                      onClick={() => setCropMode((prev) => !prev)}
                    >
                      {cropMode ? 'Exit crop mode' : 'Enter crop mode'}
                    </Button>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Safe zone overlay</p>
                      <p className="text-xs text-muted-foreground">
                        Keep captions inside platform UI bounds.
                      </p>
                    </div>
                    <Switch checked={safeZone} onCheckedChange={setSafeZone} />
                  </div>
                  <div className="space-y-2">
                    <Label>Background fill</Label>
                    <Select defaultValue="blur">
                      <SelectTrigger>
                        <SelectValue placeholder="Choose background" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="blur">Blurred original</SelectItem>
                        <SelectItem value="solid">Solid black</SelectItem>
                        <SelectItem value="gradient">Dark gradient</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Crop box</Label>
                    <div className="rounded-lg border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
                      X {crop.x.toFixed(2)} · Y {crop.y.toFixed(2)} · W {crop.w.toFixed(2)} · H{' '}
                      {crop.h.toFixed(2)}
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Crop templates</CardTitle>
                  <CardDescription>Save reusable crops and apply them fast.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="template-name">Template name</Label>
                    <Input
                      id="template-name"
                      value={templateName}
                      onChange={(event) => setTemplateName(event.target.value)}
                      placeholder="Template 1"
                    />
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={handleSaveTemplate}>
                        Save template
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCrop(DEFAULT_CROP)}
                      >
                        Reset crop
                      </Button>
                    </div>
                    {templateMessage ? (
                      <div className="text-xs text-muted-foreground">{templateMessage}</div>
                    ) : null}
                  </div>
                  <div className="space-y-2">
                    <Label>Saved templates</Label>
                    {templatesLoading ? (
                      <div className="text-xs text-muted-foreground">Loading templates...</div>
                    ) : templates.length === 0 ? (
                      <div className="text-xs text-muted-foreground">
                        No templates yet. Save your first crop.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {templates.map((template) => (
                          <div
                            key={template.id}
                            className="flex items-center justify-between rounded-lg border px-3 py-2"
                          >
                            <div>
                              <div className="text-sm font-medium">{template.name}</div>
                              <div className="text-xs text-muted-foreground">
                                {template.aspectRatio} · {template.isDefault ? 'Default' : 'Custom'}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => handleApplyTemplate(template)}
                            >
                              Apply
                            </Button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Text overlays</CardTitle>
                  <CardDescription>Add text boxes and position them on the clip.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" onClick={addTextOverlay}>
                      Add text
                    </Button>
                    {selectedOverlay ? (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => removeOverlay(selectedOverlay.id)}
                      >
                        Remove selected
                      </Button>
                    ) : null}
                  </div>
                  {textOverlays.length === 0 ? (
                    <div className="text-xs text-muted-foreground">
                      No text overlays yet. Add one to start.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Layers</Label>
                        <div className="space-y-2">
                          {textOverlays.map((overlay) => (
                            <button
                              key={overlay.id}
                              type="button"
                              onClick={() => setSelectedOverlayId(overlay.id)}
                              className={cn(
                                'w-full rounded-lg border px-3 py-2 text-left text-sm',
                                selectedOverlayId === overlay.id
                                  ? 'border-foreground/40 bg-muted/40'
                                  : 'border-border'
                              )}
                            >
                              {overlay.text}
                            </button>
                          ))}
                        </div>
                      </div>
                      {selectedOverlay ? (
                        <div className="space-y-3">
                          <div className="space-y-2">
                            <Label htmlFor="overlay-text">Text</Label>
                            <Input
                              id="overlay-text"
                              value={selectedOverlay.text}
                              onChange={(event) =>
                                updateOverlay(selectedOverlay.id, { text: event.target.value })
                              }
                            />
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="overlay-size">Size</Label>
                              <Input
                                id="overlay-size"
                                type="number"
                                min={12}
                                max={72}
                                value={selectedOverlay.size}
                                onChange={(event) =>
                                  updateOverlay(selectedOverlay.id, {
                                    size: Number(event.target.value) || 0,
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="overlay-color">Color</Label>
                              <Input
                                id="overlay-color"
                                type="color"
                                value={selectedOverlay.color}
                                onChange={(event) =>
                                  updateOverlay(selectedOverlay.id, { color: event.target.value })
                                }
                              />
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="space-y-2">
                              <Label htmlFor="overlay-x">X position</Label>
                              <Input
                                id="overlay-x"
                                type="number"
                                min={0}
                                max={100}
                                value={Math.round(selectedOverlay.x * 100)}
                                onChange={(event) =>
                                  updateOverlay(selectedOverlay.id, {
                                    x: Math.min(1, Math.max(0, Number(event.target.value) / 100)),
                                  })
                                }
                              />
                            </div>
                            <div className="space-y-2">
                              <Label htmlFor="overlay-y">Y position</Label>
                              <Input
                                id="overlay-y"
                                type="number"
                                min={0}
                                max={100}
                                value={Math.round(selectedOverlay.y * 100)}
                                onChange={(event) =>
                                  updateOverlay(selectedOverlay.id, {
                                    y: Math.min(1, Math.max(0, Number(event.target.value) / 100)),
                                  })
                                }
                              />
                            </div>
                          </div>
                          <div className="text-xs text-muted-foreground">
                            Tip: drag text directly on the preview to reposition.
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground">
                          Select a text layer to edit its settings.
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-4">
                  <CardTitle className="text-base">Captions</CardTitle>
                  <CardDescription>Auto captions with brand styling.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between rounded-lg border bg-muted/40 px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">Auto captions</p>
                      <p className="text-xs text-muted-foreground">
                        Sync transcript to on-screen text.
                      </p>
                    </div>
                    <Switch checked={autoCaptions} onCheckedChange={setAutoCaptions} />
                  </div>
                  <div className="space-y-2">
                    <Label>Caption style</Label>
                    <Select value={captionStyle} onValueChange={setCaptionStyle}>
                      <SelectTrigger>
                        <SelectValue placeholder="Select style" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="pop">Pop (bold + outline)</SelectItem>
                        <SelectItem value="clean">Clean minimal</SelectItem>
                        <SelectItem value="cinema">Cinema lower-third</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Caption placement</Label>
                    <Select defaultValue="lower">
                      <SelectTrigger>
                        <SelectValue placeholder="Select placement" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="lower">Lower third</SelectItem>
                        <SelectItem value="center">Centered</SelectItem>
                        <SelectItem value="top">Top headline</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
        </div>
      )}
      {clip ? (
        <div className="hidden lg:block">
          <Card className="fixed inset-x-6 bottom-6 z-30 shadow-xl">
            <CardHeader className="flex flex-col gap-3 pb-4 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-base">Timeline</CardTitle>
                <CardDescription>Trim the clip or move the hook window.</CardDescription>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setTimelineOpen((prev) => !prev)}
              >
                {timelineOpen ? 'Collapse' : 'Expand'}
              </Button>
            </CardHeader>
            {timelineOpen ? (
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>00:00</span>
                    <span>00:47</span>
                  </div>
                  <div className="relative h-16 overflow-hidden rounded-lg border bg-muted/40">
                    <div className="absolute inset-0 flex gap-1 p-2">
                      {Array.from({ length: 24 }).map((_, index) => (
                        <div
                          key={`segment-${index}`}
                          className={cn(
                            'h-full flex-1 rounded-sm',
                            index % 3 === 0
                              ? 'bg-emerald-200/80 dark:bg-emerald-500/30'
                              : 'bg-slate-200/80 dark:bg-slate-700/40'
                          )}
                        />
                      ))}
                    </div>
                    <div className="absolute inset-y-0 left-[12%] w-1.5 rounded bg-white/90 shadow-sm" />
                    <div className="absolute inset-y-0 right-[14%] w-1.5 rounded bg-white/90 shadow-sm" />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="space-y-2">
                    <Label>Clip start</Label>
                    <Input type="text" defaultValue="00:06.2" />
                  </div>
                  <div className="space-y-2">
                    <Label>Clip end</Label>
                    <Input type="text" defaultValue="00:43.8" />
                  </div>
                  <div className="space-y-2">
                    <Label>Hook emphasis</Label>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      defaultValue={72}
                      className="w-full accent-black"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Focus speaker</Label>
                    <Select defaultValue="auto">
                      <SelectTrigger>
                        <SelectValue placeholder="Select focus" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="auto">Auto</SelectItem>
                        <SelectItem value="left">Left</SelectItem>
                        <SelectItem value="center">Center</SelectItem>
                        <SelectItem value="right">Right</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </CardContent>
            ) : null}
          </Card>
        </div>
      ) : null}
    </div>
  );
}
