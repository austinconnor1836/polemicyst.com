'use client';

import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Check, ExternalLink, Loader2, Pencil, Plus, Quote, Sparkles, X } from 'lucide-react';
import toast from 'react-hot-toast';

type QuoteDisplayMode =
  | 'auto'
  | 'screenshot'
  | 'pull-quote'
  | 'lower-third'
  | 'highlight-card'
  | 'side-panel';

interface DetectedQuote {
  text: string;
  attribution: string | null;
  startS: number;
  endS: number;
  confidence: number;
  sourceUrl?: string | null;
  displayMode?: QuoteDisplayMode | null;
}

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface QuoteGraphicsPanelProps {
  compositionId: string;
  hasTranscript: boolean;
  transcriptSegments?: TranscriptSegment[] | null;
  quotes: DetectedQuote[];
  enabled: boolean;
  style: string;
  onUpdate: (quotes: DetectedQuote[], enabled: boolean, style: string) => void;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

function parseTime(str: string): number | null {
  const parts = str.split(':');
  if (parts.length === 2) {
    const m = parseInt(parts[0], 10);
    const s = parseFloat(parts[1]);
    if (!isNaN(m) && !isNaN(s)) return m * 60 + s;
  }
  const n = parseFloat(str);
  return isNaN(n) ? null : n;
}

/**
 * Fuzzy-match quote text against transcript segments to find the time range
 * where the quote is spoken. Uses normalized substring matching.
 */
function matchQuoteToTranscript(
  quoteText: string,
  segments: TranscriptSegment[]
): { startS: number; endS: number } | null {
  if (!quoteText || segments.length === 0) return null;

  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/['']/g, "'")
      .replace(/[""]/g, '"')
      .replace(/[^\w\s'"-]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

  const quoteNorm = normalize(quoteText);
  if (quoteNorm.length < 10) return null;

  // Build a continuous text with segment boundaries mapped
  const entries: { segIdx: number; charStart: number }[] = [];
  let fullText = '';
  for (let i = 0; i < segments.length; i++) {
    entries.push({ segIdx: i, charStart: fullText.length });
    fullText += (i > 0 ? ' ' : '') + normalize(segments[i].text);
  }

  // Try exact match first, then progressively shorter prefixes
  const attempts = [
    quoteNorm,
    quoteNorm.slice(0, Math.floor(quoteNorm.length * 0.7)),
    quoteNorm.slice(0, Math.floor(quoteNorm.length * 0.5)),
  ].filter((t) => t.length >= 10);

  for (const attempt of attempts) {
    const idx = fullText.indexOf(attempt);
    if (idx === -1) continue;

    const matchEnd = idx + attempt.length;

    // Find the first and last segment that overlap
    let startSeg = -1;
    let endSeg = -1;
    for (let i = 0; i < entries.length; i++) {
      const charEnd = i < entries.length - 1 ? entries[i + 1].charStart : fullText.length;
      if (charEnd > idx && startSeg === -1) startSeg = i;
      if (entries[i].charStart < matchEnd) endSeg = i;
    }

    if (startSeg >= 0 && endSeg >= 0) {
      return {
        startS: segments[startSeg].start,
        endS: segments[endSeg].end,
      };
    }
  }

  return null;
}

export function QuoteGraphicsPanel({
  compositionId,
  hasTranscript,
  transcriptSegments,
  quotes,
  enabled,
  style,
  onUpdate,
}: QuoteGraphicsPanelProps) {
  const [detecting, setDetecting] = useState(false);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState<{
    text: string;
    attribution: string;
    startS: string;
    endS: string;
    sourceUrl: string;
    displayMode: QuoteDisplayMode;
  } | null>(null);
  const [screenshotPreview, setScreenshotPreview] = useState<string | null>(null);
  const [screenshotLoading, setScreenshotLoading] = useState(false);
  const [timingAutoMatched, setTimingAutoMatched] = useState(false);
  const matchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function tryAutoMatchTiming(text: string) {
    if (!transcriptSegments || transcriptSegments.length === 0) return;
    if (matchTimeoutRef.current) clearTimeout(matchTimeoutRef.current);
    matchTimeoutRef.current = setTimeout(() => {
      const match = matchQuoteToTranscript(text, transcriptSegments);
      if (match) {
        setEditDraft((d) =>
          d ? { ...d, startS: formatTime(match.startS), endS: formatTime(match.endS) } : d
        );
        setTimingAutoMatched(true);
      } else {
        setTimingAutoMatched(false);
      }
    }, 400);
  }

  async function handleDetectQuotes() {
    setDetecting(true);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/detect-quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ style }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Detection failed' }));
        toast.error(err.error || 'Quote detection failed');
        return;
      }

      const data = await res.json();
      onUpdate(data.quotes || [], true, data.style || style);
      toast.success(
        data.quotes?.length
          ? `Found ${data.quotes.length} quoted excerpt${data.quotes.length !== 1 ? 's' : ''}`
          : 'No quoted excerpts detected in this video'
      );
    } catch {
      toast.error('Something went wrong');
    } finally {
      setDetecting(false);
    }
  }

  function handleRemoveQuote(index: number) {
    const updated = quotes.filter((_, i) => i !== index);
    onUpdate(updated, enabled, style);
    updateServer({ quotes: updated });
    if (editingIndex === index) {
      setEditingIndex(null);
      setEditDraft(null);
    }
  }

  function handleToggle(checked: boolean) {
    onUpdate(quotes, checked, style);
    updateServer({ enabled: checked });
  }

  function handleStyleChange(newStyle: string) {
    onUpdate(quotes, enabled, newStyle);
    updateServer({ style: newStyle });
  }

  function startEditing(index: number) {
    const q = quotes[index];
    setEditingIndex(index);
    setEditDraft({
      text: q.text,
      attribution: q.attribution || '',
      startS: formatTime(q.startS),
      endS: formatTime(q.endS),
      sourceUrl: q.sourceUrl || '',
      displayMode: q.displayMode || 'auto',
    });
    setScreenshotPreview(null);
    setTimingAutoMatched(false);
  }

  function cancelEditing() {
    setEditingIndex(null);
    setEditDraft(null);
    setScreenshotPreview(null);
    setTimingAutoMatched(false);
  }

  async function handlePreviewScreenshot() {
    if (!editDraft?.sourceUrl || !editDraft.text) return;
    setScreenshotLoading(true);
    setScreenshotPreview(null);
    try {
      const res = await fetch(`/api/compositions/${compositionId}/quote-screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl: editDraft.sourceUrl,
          quoteText: editDraft.text,
          attribution: editDraft.attribution || undefined,
        }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Failed' }));
        toast.error(err.error || 'Screenshot failed');
        return;
      }
      const data = await res.json();
      setScreenshotPreview(data.preview);
      if (data.textFound) {
        toast.success('Quote found and highlighted on the page');
      } else {
        toast('Page captured, but exact quote text was not found', {
          icon: '⚠️',
        });
      }
    } catch {
      toast.error('Screenshot request failed');
    } finally {
      setScreenshotLoading(false);
    }
  }

  function saveEditing() {
    if (editingIndex === null || !editDraft) return;

    const startS = parseTime(editDraft.startS);
    const endS = parseTime(editDraft.endS);
    if (startS === null || endS === null || endS <= startS) {
      toast.error('Invalid time range');
      return;
    }
    if (!editDraft.text.trim()) {
      toast.error('Quote text cannot be empty');
      return;
    }

    const updated = [...quotes];
    updated[editingIndex] = {
      ...updated[editingIndex],
      text: editDraft.text.trim(),
      attribution: editDraft.attribution.trim() || null,
      startS,
      endS,
      sourceUrl: editDraft.sourceUrl.trim() || null,
      displayMode: editDraft.displayMode,
    };

    onUpdate(updated, enabled, style);
    updateServer({ quotes: updated });
    setEditingIndex(null);
    setEditDraft(null);
    toast.success('Quote updated');
  }

  function handleAddQuote() {
    const newQuote: DetectedQuote = {
      text: '',
      attribution: null,
      startS: 0,
      endS: 10,
      confidence: 1,
    };
    const updated = [...quotes, newQuote];
    onUpdate(updated, enabled, style);
    startEditing(updated.length - 1);
  }

  async function updateServer(data: {
    quotes?: DetectedQuote[];
    enabled?: boolean;
    style?: string;
  }) {
    try {
      await fetch(`/api/compositions/${compositionId}/detect-quotes`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    } catch {
      // Non-fatal
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Quote className="h-4 w-4 text-muted" />
          <Label className="text-sm font-medium">Quote Graphics</Label>
          {quotes.length > 0 && (
            <Badge variant="secondary" className="text-xs">
              {quotes.length} detected
            </Badge>
          )}
        </div>
        <Switch checked={enabled} onCheckedChange={handleToggle} />
      </div>

      {enabled && (
        <div className="space-y-3">
          <div className="flex gap-2">
            <Select value={style} onValueChange={handleStyleChange}>
              <SelectTrigger className="flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pull-quote">Pull Quote</SelectItem>
                <SelectItem value="lower-third">Lower Third</SelectItem>
                <SelectItem value="highlight-card">Highlight Card</SelectItem>
                <SelectItem value="side-panel">Side Panel</SelectItem>
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleDetectQuotes}
              disabled={detecting || !hasTranscript}
            >
              {detecting ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="mr-1.5 h-3.5 w-3.5" />
              )}
              {quotes.length > 0 ? 'Re-detect' : 'Detect'}
            </Button>
          </div>

          {!hasTranscript && (
            <p className="text-xs text-muted">
              Waiting for transcript — quote detection requires a completed transcript.
            </p>
          )}

          {quotes.length > 0 && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {quotes.map((q, i) =>
                editingIndex === i && editDraft ? (
                  <div
                    key={i}
                    className="rounded-lg border-2 border-primary bg-surface/50 p-3 text-sm space-y-2.5 glass:bg-white/[0.06] glass:border-white/20"
                  >
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted">Quote text</Label>
                      <Textarea
                        value={editDraft.text}
                        onChange={(e) => {
                          const val = e.target.value;
                          setEditDraft((d) => (d ? { ...d, text: val } : d));
                          tryAutoMatchTiming(val);
                        }}
                        placeholder="Enter the quote text…"
                        rows={3}
                        className="text-sm resize-none"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted">Attribution (optional)</Label>
                      <Input
                        value={editDraft.attribution}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, attribution: e.target.value } : d))
                        }
                        placeholder="e.g. Jonathan Winer, Clinton State Dept."
                        className="text-sm h-8"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted">Source URL (optional)</Label>
                      <Input
                        value={editDraft.sourceUrl}
                        onChange={(e) =>
                          setEditDraft((d) => (d ? { ...d, sourceUrl: e.target.value } : d))
                        }
                        placeholder="https://example.com/article"
                        className="text-sm h-8"
                        type="url"
                      />
                      {editDraft.sourceUrl && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs gap-1 w-full"
                          onClick={handlePreviewScreenshot}
                          disabled={screenshotLoading || !editDraft.text}
                        >
                          {screenshotLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <ExternalLink className="h-3 w-3" />
                          )}
                          {screenshotLoading ? 'Capturing…' : 'Preview Screenshot'}
                        </Button>
                      )}
                      {!editDraft.sourceUrl && (
                        <p className="text-[11px] text-muted leading-tight">
                          Paste the article link to screenshot the actual page with the quote
                          highlighted.
                        </p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted">Display format</Label>
                      <Select
                        value={editDraft.displayMode}
                        onValueChange={(v) =>
                          setEditDraft((d) =>
                            d ? { ...d, displayMode: v as QuoteDisplayMode } : d
                          )
                        }
                      >
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">
                            Auto{editDraft.sourceUrl ? ' (screenshot)' : ' (graphic)'}
                          </SelectItem>
                          {editDraft.sourceUrl && (
                            <SelectItem value="screenshot">
                              Screenshot — capture the source page
                            </SelectItem>
                          )}
                          <SelectItem value="pull-quote">
                            Pull Quote — centered card with quote marks
                          </SelectItem>
                          <SelectItem value="lower-third">
                            Lower Third — text bar at bottom
                          </SelectItem>
                          <SelectItem value="highlight-card">
                            Highlight Card — accent border card
                          </SelectItem>
                          <SelectItem value="side-panel">Side Panel — panel on one side</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    {screenshotPreview && (
                      <div className="space-y-1.5">
                        <Label className="text-xs text-muted">Preview</Label>
                        <div className="relative overflow-hidden rounded-lg border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={screenshotPreview}
                            alt="Quote screenshot preview"
                            className="w-full h-auto max-h-48 object-contain bg-black"
                          />
                        </div>
                      </div>
                    )}
                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2">
                        <Label className="text-xs text-muted">Timing</Label>
                        {timingAutoMatched && (
                          <span className="text-[11px] text-primary font-medium">
                            ✓ matched from transcript
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={editDraft.startS}
                          onChange={(e) => {
                            setEditDraft((d) => (d ? { ...d, startS: e.target.value } : d));
                            setTimingAutoMatched(false);
                          }}
                          placeholder="0:05"
                          className="text-sm h-8 font-mono"
                        />
                        <span className="flex items-center text-xs text-muted">–</span>
                        <Input
                          value={editDraft.endS}
                          onChange={(e) => {
                            setEditDraft((d) => (d ? { ...d, endS: e.target.value } : d));
                            setTimingAutoMatched(false);
                          }}
                          placeholder="0:15"
                          className="text-sm h-8 font-mono"
                        />
                      </div>
                    </div>
                    <div className="flex justify-end gap-2 pt-1">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 text-xs"
                        onClick={cancelEditing}
                      >
                        Cancel
                      </Button>
                      <Button size="sm" className="h-7 text-xs gap-1" onClick={saveEditing}>
                        <Check className="h-3 w-3" />
                        Save
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div
                    key={i}
                    className="group relative rounded-lg border border-border bg-surface/50 p-3 text-sm glass:bg-white/[0.04] glass:border-white/10"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-foreground line-clamp-2">
                          &ldquo;{q.text}&rdquo;
                        </p>
                        <div className="mt-1 flex items-center gap-2 text-xs text-muted">
                          <span>
                            {formatTime(q.startS)} – {formatTime(q.endS)}
                          </span>
                          {q.attribution && (
                            <>
                              <span>·</span>
                              <span className="truncate">{q.attribution}</span>
                            </>
                          )}
                          {q.sourceUrl && (
                            <>
                              <span>·</span>
                              <a
                                href={q.sourceUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-0.5 text-primary hover:underline"
                                onClick={(e) => e.stopPropagation()}
                              >
                                <ExternalLink className="h-3 w-3" />
                                Source
                              </a>
                            </>
                          )}
                          {q.displayMode && q.displayMode !== 'auto' && (
                            <>
                              <span>·</span>
                              <span className="capitalize">
                                {q.displayMode === 'screenshot'
                                  ? '📷'
                                  : q.displayMode.replace('-', ' ')}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span>{Math.round(q.confidence * 100)}%</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
                        <button
                          onClick={() => startEditing(i)}
                          className="rounded p-1 text-muted hover:bg-primary/10 hover:text-primary"
                          title="Edit quote"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => handleRemoveQuote(i)}
                          className="rounded p-1 text-muted hover:bg-destructive/10 hover:text-destructive"
                          title="Remove quote"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                )
              )}
            </div>
          )}

          <Button
            size="sm"
            variant="outline"
            className="h-7 w-full gap-1 text-xs"
            onClick={handleAddQuote}
          >
            <Plus className="h-3 w-3" />
            Add Quote Manually
          </Button>

          {quotes.length === 0 && hasTranscript && (
            <p className="text-xs text-muted">
              Click &ldquo;Detect&rdquo; to auto-find quoted passages, or add one manually. Edit the
              text to customize what appears in the graphic overlay.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
