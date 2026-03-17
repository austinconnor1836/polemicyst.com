'use client';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Trash2 } from 'lucide-react';

interface Track {
  id: string;
  label?: string | null;
  s3Url: string;
  durationS: number;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
  hasAudio: boolean;
}

interface ReferenceTrackPanelProps {
  track: Track;
  index: number;
  mode: 'pre-synced' | 'timeline';
  onUpdate: (trackId: string, data: Partial<Track>) => void;
  onRemove: (trackId: string) => void;
  disabled?: boolean;
}

export function ReferenceTrackPanel({
  track,
  index,
  mode,
  onUpdate,
  onRemove,
  disabled,
}: ReferenceTrackPanelProps) {
  const effectiveDuration = (track.trimEndS ?? track.durationS) - track.trimStartS;

  return (
    <Card className="group overflow-hidden shadow-sm transition-all hover:shadow-md hover:ring-2 hover:ring-primary/20">
      <CardContent className="p-0">
        <div className="relative">
          <video
            src={track.s3Url}
            preload="metadata"
            muted
            playsInline
            tabIndex={-1}
            className="aspect-video w-full bg-black/5 object-cover"
          />
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/40 via-black/0 to-black/0 opacity-60 transition-opacity group-hover:opacity-80" />

          <Button
            variant="secondary"
            size="icon"
            className="absolute right-2 top-2 h-8 w-8 rounded-full bg-white/85 text-gray-900 opacity-0 backdrop-blur transition-opacity hover:bg-white group-hover:opacity-100 dark:bg-zinc-900/80 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => onRemove(track.id)}
            disabled={disabled}
            title="Remove track"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>

        <div className="space-y-2 p-4">
          <div className="line-clamp-2 font-semibold leading-snug">
            {track.label || `Reference ${index + 1}`}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Reference {index + 1}</Badge>
            <span className="text-xs text-muted-foreground">{effectiveDuration.toFixed(1)}s</span>
            {!track.hasAudio && <span className="text-xs text-muted-foreground">No audio</span>}
          </div>

          <div className="grid grid-cols-2 gap-2 pt-1">
            {mode === 'timeline' && (
              <div>
                <Label className="text-xs">Start at (s)</Label>
                <Input
                  type="number"
                  min={0}
                  step={0.5}
                  value={track.startAtS}
                  onChange={(e) =>
                    onUpdate(track.id, { startAtS: parseFloat(e.target.value) || 0 })
                  }
                  disabled={disabled}
                  className="h-8 text-sm"
                />
              </div>
            )}
            <div>
              <Label className="text-xs">Trim start (s)</Label>
              <Input
                type="number"
                min={0}
                max={track.durationS}
                step={0.5}
                value={track.trimStartS}
                onChange={(e) =>
                  onUpdate(track.id, { trimStartS: parseFloat(e.target.value) || 0 })
                }
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
            <div>
              <Label className="text-xs">Trim end (s)</Label>
              <Input
                type="number"
                min={0}
                max={track.durationS}
                step={0.5}
                value={track.trimEndS ?? track.durationS}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  onUpdate(track.id, { trimEndS: isNaN(v) ? null : v });
                }}
                disabled={disabled}
                className="h-8 text-sm"
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
