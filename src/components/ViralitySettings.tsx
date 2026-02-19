'use client';

import React from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  type ContentStyle,
  type LLMProvider,
  type ScoringMode,
  type StrictnessPreset,
  type TargetPlatform,
  type ViralitySettingsValue,
  getStrictnessConfig,
} from '@shared/virality';

export type ViralitySettingsProps = {
  value: ViralitySettingsValue;
  onChange: (next: ViralitySettingsValue) => void;
  className?: string;
  defaultLLMProvider?: LLMProvider;
  onPersistLLMProvider?: (provider: LLMProvider) => void | Promise<void>;
  isPersistingLLMProvider?: boolean;
};

export default function ViralitySettings({
  value,
  onChange,
  className,
  defaultLLMProvider = 'gemini',
  onPersistLLMProvider,
  isPersistingLLMProvider = false,
}: ViralitySettingsProps) {
  const strictnessConfig = getStrictnessConfig(value.strictnessPreset);

  return (
    <div className={cn('space-y-4', className)}>
      <div className="space-y-2">
        <Label>Target platform</Label>
        <Select
          value={value.targetPlatform}
          onValueChange={(v) => onChange({ ...value, targetPlatform: v as TargetPlatform })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a platform target" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All (general)</SelectItem>
            <SelectItem value="reels">IG/FB Reels</SelectItem>
            <SelectItem value="shorts">YouTube Shorts</SelectItem>
            <SelectItem value="youtube">YouTube (longer clips)</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-gray-500">
          The scorer will optimize different hooks/lengths for each platform.
        </div>
      </div>

      <div className="space-y-2">
        <Label>Clip length</Label>
        <Select
          value={value.clipLength || 'auto'}
          onValueChange={(v) => onChange({ ...value, clipLength: v as any })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select clip length" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto (Smart)</SelectItem>
            <SelectItem value="lt30s">&lt; 30s (Shorts/Reels)</SelectItem>
            <SelectItem value="30s-60s">30s - 60s</SelectItem>
            <SelectItem value="60s-90s">60s - 90s</SelectItem>
            <SelectItem value="lt3m">Up to 3m</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-gray-500">
          Restrict candidates to specific duration ranges to speed up processing.
        </div>
      </div>

      <div className="space-y-2">
        <Label>Content style</Label>
        <Select
          value={value.contentStyle}
          onValueChange={(v) => onChange({ ...value, contentStyle: v as ContentStyle })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select a content style" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">Auto-detect (recommended)</SelectItem>
            <SelectItem value="politics">News/Politics</SelectItem>
            <SelectItem value="comedy">Comedy/Entertainment</SelectItem>
            <SelectItem value="education">Education/Explainers</SelectItem>
            <SelectItem value="podcast">Podcast/Interview</SelectItem>
            <SelectItem value="gaming">Gaming</SelectItem>
            <SelectItem value="vlog">Vlog/Lifestyle</SelectItem>
            <SelectItem value="other">Other</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-gray-500">
          {value.contentStyle === 'auto'
            ? 'We’ll auto-detect style from the transcript during scoring.'
            : 'Overrides auto-detection and tunes scoring for this style.'}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Scoring</Label>
        <Select
          value={value.scoringMode}
          onValueChange={(v) => onChange({ ...value, scoringMode: v as ScoringMode })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select scoring mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hybrid">Hybrid (cheap + smart)</SelectItem>
            <SelectItem value="gemini">LLM only (quality depends on provider)</SelectItem>
            <SelectItem value="heuristic">Heuristic only (fastest, cheapest)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="space-y-2">
        <Label>LLM provider</Label>
        <Select
          value={value.llmProvider}
          onValueChange={(v) => onChange({ ...value, llmProvider: v as LLMProvider })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select provider" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="gemini">Gemini (multimodal, hosted)</SelectItem>
            <SelectItem value="ollama">Ollama (local, transcript + media stats)</SelectItem>
          </SelectContent>
        </Select>
        <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500">
          <span>Default: {defaultLLMProvider}</span>
          {onPersistLLMProvider ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => onPersistLLMProvider(value.llmProvider)}
              disabled={isPersistingLLMProvider}
            >
              {isPersistingLLMProvider ? 'Saving…' : 'Save as default'}
            </Button>
          ) : null}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Virality strictness</Label>
        <Select
          value={value.strictnessPreset}
          onValueChange={(v) => onChange({ ...value, strictnessPreset: v as StrictnessPreset })}
        >
          <SelectTrigger>
            <SelectValue placeholder="Select strictness" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="balanced">Balanced</SelectItem>
            <SelectItem value="strict">Strict (fewer, higher confidence)</SelectItem>
            <SelectItem value="loose">Loose (more candidates)</SelectItem>
          </SelectContent>
        </Select>
        <div className="text-xs text-gray-500">
          Current: minScore {strictnessConfig.minScore}, percentile {strictnessConfig.percentile},
          max {strictnessConfig.maxCandidates}
        </div>
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label>Include audio</Label>
          <div className="text-xs text-gray-500">Higher cost, sometimes better judgments</div>
        </div>
        <Switch
          checked={value.includeAudio}
          onCheckedChange={(checked) => onChange({ ...value, includeAudio: !!checked })}
        />
      </div>

      <div className="flex items-center justify-between gap-3">
        <div className="space-y-0.5">
          <Label>Safer clips</Label>
          <div className="text-xs text-gray-500">
            Downranks high-risk segments and favors context-complete moments
          </div>
        </div>
        <Switch
          checked={value.saferClips}
          onCheckedChange={(checked) => onChange({ ...value, saferClips: !!checked })}
        />
      </div>

      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto py-0 text-xs"
        onClick={() => onChange({ ...value, showAdvanced: !value.showAdvanced })}
      >
        {value.showAdvanced ? 'Hide advanced' : 'Show advanced'}
      </Button>

      {value.showAdvanced && (
        <div className="rounded border border-gray-200 bg-gray-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/40">
          <div className="mb-2 text-xs text-gray-700 dark:text-gray-300">
            Advanced knobs are cost controls. LLM calls (Gemini/Ollama) are capped by{' '}
            <code>maxGeminiCandidates</code>.
          </div>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <div className="text-xs text-gray-500">minCandidates</div>
              <div className="font-mono">{strictnessConfig.minCandidates}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">maxCandidates</div>
              <div className="font-mono">{strictnessConfig.maxCandidates}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">minScore</div>
              <div className="font-mono">{strictnessConfig.minScore}</div>
            </div>
            <div>
              <div className="text-xs text-gray-500">percentile</div>
              <div className="font-mono">{strictnessConfig.percentile}</div>
            </div>
            <div className="col-span-2">
              <div className="text-xs text-gray-500">maxGeminiCandidates</div>
              <div className="font-mono">{strictnessConfig.maxGeminiCandidates}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
