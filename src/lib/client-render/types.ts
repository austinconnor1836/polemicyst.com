/**
 * Shared types for the client-side rendering pipeline.
 * Mirrors server-side ComposeOptions but uses blob URLs + File objects
 * instead of S3 paths.
 */

export type Layout = 'mobile' | 'landscape';
export type AudioMode = 'creator' | 'reference' | 'both';

export interface ClientTrackInfo {
  file: File;
  startAtS: number;
  trimStartS: number;
  trimEndS: number | null;
  durationS: number;
  width: number;
  height: number;
  hasAudio: boolean;
  sortOrder: number;
  /** When set, the track is a landscape video with embedded portrait content.
   *  The crop rect extracts the portrait region before scaling. */
  sourceCrop?: { w: number; h: number; x: number; y: number } | null;
}

/** A pre-computed caption segment in output timeline coordinates. */
export interface CaptionSegment {
  startS: number;
  endS: number;
  text: string;
}

export interface CaptionOptions {
  segments: CaptionSegment[];
  fontSizePx?: number; // Default: 36 (medium)
}

export interface ClientRenderOptions {
  layout: Layout;
  creatorFile: File;
  creatorDurationS: number;
  creatorTrimStartS: number;
  creatorTrimEndS: number | null;
  creatorWidth: number;
  creatorHeight: number;
  tracks: ClientTrackInfo[];
  audioMode: AudioMode;
  creatorVolume: number;
  referenceVolume: number;
  captions?: CaptionOptions;
}

export type RenderPhase =
  | 'preparing'
  | 'demuxing'
  | 'rendering'
  | 'encoding-audio'
  | 'muxing'
  | 'complete'
  | 'error';

export interface RenderProgress {
  phase: RenderPhase;
  percent: number;
  currentFrame?: number;
  totalFrames?: number;
  message?: string;
}

/** Messages sent from main thread to worker */
export interface WorkerMessage {
  type: 'start';
  options: ClientRenderOptions;
}

/** Messages sent from worker back to main thread */
export type WorkerResponse =
  | { type: 'progress'; progress: RenderProgress }
  | { type: 'complete'; blob: Blob }
  | { type: 'error'; message: string };

// Layout constants — must match shared/util/reactionCompose.ts
export const MOBILE_CANVAS_W = 720;
export const MOBILE_CANVAS_H = 1280;
export const LANDSCAPE_CANVAS_W = 1280;
export const LANDSCAPE_CANVAS_H = 720;

export const PIP_W = 480;
export const PIP_H = 270;

export const MOBILE_CREATOR_W = 720;
export const MOBILE_CREATOR_H = 405;

export const TARGET_FPS = 30;
export const VIDEO_BITRATE = 4_000_000; // 4 Mbps
export const AUDIO_BITRATE = 128_000; // 128 kbps
export const AUDIO_SAMPLE_RATE = 44100;
export const AUDIO_CHANNELS = 2;

/**
 * A decoded video frame stored as an OffscreenCanvas snapshot.
 * VideoFrames are backed by a limited GPU texture pool (~16-32 textures)
 * in Chrome's VideoDecoder. Converting to OffscreenCanvas immediately
 * in the decoder output callback frees the texture back to the pool,
 * preventing texture recycling that causes garbled/glitchy output.
 */
export interface DecodedFrame {
  source: OffscreenCanvas;
  timestamp: number;
  displayWidth: number;
  displayHeight: number;
}
