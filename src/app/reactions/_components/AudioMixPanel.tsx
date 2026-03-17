'use client';

import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type AudioMode = 'creator' | 'reference' | 'both';

interface AudioMixPanelProps {
  audioMode: AudioMode;
  creatorVolume: number;
  referenceVolume: number;
  onAudioModeChange: (mode: AudioMode) => void;
  onCreatorVolumeChange: (volume: number) => void;
  onReferenceVolumeChange: (volume: number) => void;
}

const modes: { value: AudioMode; label: string; description: string }[] = [
  { value: 'creator', label: 'Creator only', description: 'Use only your commentary audio' },
  { value: 'reference', label: 'Reference only', description: 'Use only reference clip audio' },
  { value: 'both', label: 'Mix both', description: 'Combine both audio sources' },
];

export function AudioMixPanel({
  audioMode,
  creatorVolume,
  referenceVolume,
  onAudioModeChange,
  onCreatorVolumeChange,
  onReferenceVolumeChange,
}: AudioMixPanelProps) {
  return (
    <div className="space-y-4">
      <Label>Audio Mixing</Label>

      <div className="flex gap-2">
        {modes.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => onAudioModeChange(m.value)}
            className={cn(
              'flex-1 rounded-lg border px-3 py-2 text-left text-sm transition-colors',
              audioMode === m.value
                ? 'border-blue-500 bg-blue-50 text-blue-700 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-300'
                : 'border-border bg-background text-muted-foreground hover:bg-muted'
            )}
          >
            <div className="font-medium">{m.label}</div>
            <div className="mt-0.5 text-xs opacity-80">{m.description}</div>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-4">
        {(audioMode === 'creator' || audioMode === 'both') && (
          <div className="space-y-1">
            <Label className="text-xs">Creator Volume</Label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={creatorVolume}
                onChange={(e) => onCreatorVolumeChange(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                {Math.round(creatorVolume * 100)}%
              </span>
            </div>
          </div>
        )}
        {(audioMode === 'reference' || audioMode === 'both') && (
          <div className="space-y-1">
            <Label className="text-xs">Reference Volume</Label>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={0}
                max={2}
                step={0.1}
                value={referenceVolume}
                onChange={(e) => onReferenceVolumeChange(parseFloat(e.target.value))}
                className="flex-1"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">
                {Math.round(referenceVolume * 100)}%
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
