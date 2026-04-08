'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, Quote, Sparkles, Trash2, X } from 'lucide-react';
import toast from 'react-hot-toast';

interface DetectedQuote {
  text: string;
  attribution: string | null;
  startS: number;
  endS: number;
  confidence: number;
}

interface QuoteGraphicsPanelProps {
  compositionId: string;
  hasTranscript: boolean;
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

export function QuoteGraphicsPanel({
  compositionId,
  hasTranscript,
  quotes,
  enabled,
  style,
  onUpdate,
}: QuoteGraphicsPanelProps) {
  const [detecting, setDetecting] = useState(false);

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
  }

  function handleToggle(checked: boolean) {
    onUpdate(quotes, checked, style);
    updateServer({ enabled: checked });
  }

  function handleStyleChange(newStyle: string) {
    onUpdate(quotes, enabled, newStyle);
    updateServer({ style: newStyle });
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
              {quotes.length > 0 ? 'Re-detect' : 'Detect Quotes'}
            </Button>
          </div>

          {!hasTranscript && (
            <p className="text-xs text-muted">
              Waiting for transcript — quote detection requires a completed transcript.
            </p>
          )}

          {quotes.length > 0 && (
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {quotes.map((q, i) => (
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
                        <span>·</span>
                        <span>{Math.round(q.confidence * 100)}% confidence</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveQuote(i)}
                      className="shrink-0 rounded p-1 text-muted opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {quotes.length === 0 && hasTranscript && (
            <p className="text-xs text-muted">
              Click &ldquo;Detect Quotes&rdquo; to analyze your video for cited passages, excerpts,
              and quoted material. Detected quotes will appear as styled graphics in the rendered
              video.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
