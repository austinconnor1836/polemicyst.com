/**
 * WebCodecs video/audio encoder configuration and helpers.
 */
import type { Layout } from './types';
import {
  MOBILE_CANVAS_W,
  MOBILE_CANVAS_H,
  LANDSCAPE_CANVAS_W,
  LANDSCAPE_CANVAS_H,
  VIDEO_BITRATE,
  TARGET_FPS,
} from './types';

export interface EncoderConfig {
  width: number;
  height: number;
  bitrate: number;
  fps: number;
  codec: string;
}

/**
 * Get the video encoder config for a layout.
 */
export function getVideoEncoderConfig(layout: Layout): VideoEncoderConfig {
  const isMobile = layout === 'mobile';
  const width = isMobile ? MOBILE_CANVAS_W : LANDSCAPE_CANVAS_W;
  const height = isMobile ? MOBILE_CANVAS_H : LANDSCAPE_CANVAS_H;

  return {
    codec: 'avc1.640028', // H.264 High Profile Level 4.0
    width,
    height,
    bitrate: VIDEO_BITRATE,
    framerate: TARGET_FPS,
    latencyMode: 'realtime', // Force sequential output (no B-frames) for muxer compatibility
    avc: { format: 'avc' }, // Length-prefixed NALUs for mp4-muxer
  };
}

/**
 * Get the audio encoder config.
 */
export function getAudioEncoderConfig(): AudioEncoderConfig {
  return {
    codec: 'mp4a.40.2', // AAC-LC
    sampleRate: 44100,
    numberOfChannels: 2,
    bitrate: 128_000,
  };
}

/**
 * Create a configured VideoEncoder that pushes chunks to the provided callback.
 */
export function createVideoEncoder(
  layout: Layout,
  onChunk: (chunk: EncodedVideoChunk, meta: EncodedVideoChunkMetadata) => void,
  onError: (err: Error) => void
): VideoEncoder {
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      onChunk(chunk, meta ?? {});
    },
    error: onError,
  });

  encoder.configure(getVideoEncoderConfig(layout));
  return encoder;
}

/**
 * Create a configured AudioEncoder that pushes chunks to the provided callback.
 */
export function createAudioEncoder(
  onChunk: (chunk: EncodedAudioChunk, meta: EncodedAudioChunkMetadata) => void,
  onError: (err: Error) => void
): AudioEncoder {
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      onChunk(chunk, meta ?? {});
    },
    error: onError,
  });

  encoder.configure(getAudioEncoderConfig());
  return encoder;
}
