# Auto-Edit

Automatically removes silence and bad takes from creator footage in reaction compositions.

## How it works

Auto-edit uses a **dual-detection approach**:

1. **FFmpeg silencedetect** (audio waveform) — finds silence by analyzing actual audio amplitude, regardless of transcript boundaries. This catches pauses _within_ transcript segments that transcript-gap analysis would miss.

2. **Transcript-based bad take detection** — uses Levenshtein similarity and n-gram prefix matching to identify repeated phrases and false starts. Requires text comparison, so this always runs against the transcript.

Both sets of cuts are merged, deduplicated, and returned as a single result.

## Detection pipeline

```
Creator video (S3)
  │
  ├─→ Download to temp file
  │     └─→ FFmpeg silencedetect → silence regions
  │           └─→ Apply buffer (minSilenceToKeepS) on each edge
  │
  ├─→ Transcript segments (already in DB)
  │     └─→ Bad take detection (Levenshtein + false starts)
  │
  └─→ Merge overlapping cuts → AutoEditResult
        └─→ Optionally persist to Composition.cuts
```

## FFmpeg silencedetect

Runs: `ffmpeg -i <video> -af silencedetect=noise=<threshold>dB:d=<minDuration> -f null -`

Parses stderr for `silence_start` / `silence_end` lines to extract silence regions.

### Aggressiveness → FFmpeg parameters

| Aggressiveness | Noise threshold | Min silence duration | Edge buffer |
| -------------- | --------------- | -------------------- | ----------- |
| Conservative   | -35 dB          | 3.0s                 | 0.75s       |
| Balanced       | -30 dB          | 1.5s                 | 0.50s       |
| Aggressive     | -25 dB          | 0.75s                | 0.25s       |

- **Noise threshold**: Audio below this level is considered silence. Lower (more negative) = only very quiet audio counts as silence.
- **Min silence duration**: Silence shorter than this is ignored. Lower = more cuts.
- **Edge buffer** (`minSilenceToKeepS`): Padding kept on each side of a silence cut to avoid clipping speech.

## Bad take detection

### Repeated phrases

Sliding window (sizes 2–4) over consecutive transcript segments. Groups are compared using normalized Levenshtein similarity. If similarity > 60%, the earlier occurrence is marked as a bad take (the retry is kept).

### False starts

A short segment (≤ 3 words) followed by a longer segment that begins with the same words. The short segment is cut.

## Settings

| Field               | Type                                         | Default    | Description                                    |
| ------------------- | -------------------------------------------- | ---------- | ---------------------------------------------- |
| `aggressiveness`    | `conservative` \| `balanced` \| `aggressive` | `balanced` | Controls FFmpeg detection sensitivity          |
| `minSilenceToKeepS` | number                                       | 0.5        | Buffer on each edge of silence cuts (seconds)  |
| `badTakeDetection`  | boolean                                      | true       | Enable repeated phrase / false start detection |

Settings are stored per-user in `AutomationRule.autoEditSettings` (JSON) and can be overridden per-request.

## API

### `POST /api/compositions/:id/auto-edit`

Analyzes the composition's creator video for silence and bad takes.

**Request body** (all optional):

```json
{
  "settings": {
    "aggressiveness": "balanced",
    "minSilenceToKeepS": 0.5,
    "badTakeDetection": true
  },
  "apply": true
}
```

- `settings` — overrides for this request (merged with user's saved defaults)
- `apply` — if `true`, persists the cuts to `Composition.cuts`

**Response:**

```json
{
  "cuts": [
    {
      "id": "auto_1234567890_abc123",
      "startS": 5.2,
      "endS": 8.7,
      "reason": "silence",
      "detail": "3.5s silence (audio-level)"
    }
  ],
  "summary": {
    "silenceCuts": 3,
    "badTakeCuts": 1,
    "totalCuts": 4,
    "totalRemovedS": 12.5,
    "originalDurationS": 120.0,
    "newDurationS": 107.5
  }
}
```

## How cuts are applied during render

Cuts stored in `Composition.cuts` are applied **globally to all tracks** during FFmpeg rendering. The render pipeline:

1. Reads `cuts` from the composition
2. Computes "kept segments" (inverse of cuts)
3. Applies to all tracks (creator + reference videos)
4. Adjusts caption timestamps to account for removed sections

See `shared/util/reactionCompose.ts` for the rendering implementation.
