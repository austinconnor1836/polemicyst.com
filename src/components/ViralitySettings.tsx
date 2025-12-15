"use client"

import React from "react"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

export type ScoringMode = "hybrid" | "gemini" | "heuristic"
export type StrictnessPreset = "strict" | "balanced" | "loose"

export type StrictnessConfig = {
  minCandidates: number
  maxCandidates: number
  minScore: number
  percentile: number
  maxGeminiCandidates: number
}

export function getStrictnessConfig(preset: StrictnessPreset): StrictnessConfig {
  switch (preset) {
    case "strict":
      return { minScore: 7.0, percentile: 0.9, minCandidates: 3, maxCandidates: 12, maxGeminiCandidates: 18 }
    case "loose":
      return { minScore: 6.0, percentile: 0.75, minCandidates: 5, maxCandidates: 24, maxGeminiCandidates: 36 }
    case "balanced":
    default:
      return { minScore: 6.5, percentile: 0.85, minCandidates: 3, maxCandidates: 20, maxGeminiCandidates: 24 }
  }
}

export type ViralitySettingsValue = {
  scoringMode: ScoringMode
  strictnessPreset: StrictnessPreset
  includeAudio: boolean
  showAdvanced: boolean
}

export type ViralitySettingsProps = {
  value: ViralitySettingsValue
  onChange: (next: ViralitySettingsValue) => void
  className?: string
}

export default function ViralitySettings({ value, onChange, className }: ViralitySettingsProps) {
  const strictnessConfig = getStrictnessConfig(value.strictnessPreset)

  return (
    <div className={cn("space-y-4", className)}>
      <div className="space-y-2">
        <Label>Scoring</Label>
        <Select value={value.scoringMode} onValueChange={(v) => onChange({ ...value, scoringMode: v as ScoringMode })}>
          <SelectTrigger>
            <SelectValue placeholder="Select scoring mode" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="hybrid">Hybrid (cheap + smart)</SelectItem>
            <SelectItem value="gemini">Gemini only (highest quality, highest cost)</SelectItem>
            <SelectItem value="heuristic">Heuristic only (fastest, cheapest)</SelectItem>
          </SelectContent>
        </Select>
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
          Current: minScore {strictnessConfig.minScore}, percentile {strictnessConfig.percentile}, max {strictnessConfig.maxCandidates}
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

      <button
        type="button"
        className="text-xs text-blue-600 underline"
        onClick={() => onChange({ ...value, showAdvanced: !value.showAdvanced })}
      >
        {value.showAdvanced ? "Hide advanced" : "Show advanced"}
      </button>

      {value.showAdvanced && (
        <div className="border rounded p-3 bg-gray-50">
          <div className="text-xs text-gray-700 mb-2">
            Advanced knobs are cost controls. Gemini calls are capped by <code>maxGeminiCandidates</code>.
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
  )
}



