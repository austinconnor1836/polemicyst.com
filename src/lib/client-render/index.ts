/**
 * Public API for client-side rendering.
 * Wraps the Web Worker to provide a simple promise-based interface.
 */
import type { ClientRenderOptions, RenderProgress } from './types';

export type { ClientRenderOptions, RenderProgress } from './types';
export type { Layout, AudioMode, ClientTrackInfo } from './types';
export { spliceMP4, computeKeptSegments } from './mp4-splicer';

/**
 * Check if the browser supports client-side rendering via WebCodecs.
 * iOS Safari exposes WebCodecs APIs but the VideoDecoder is unreliable
 * (produces 0 output frames for many H.264 files), so we exclude it.
 */
export function supportsClientRender(): boolean {
  if (typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent)) {
    return false;
  }
  return (
    typeof VideoEncoder !== 'undefined' &&
    typeof VideoDecoder !== 'undefined' &&
    typeof AudioEncoder !== 'undefined' &&
    typeof AudioDecoder !== 'undefined' &&
    typeof OffscreenCanvas !== 'undefined'
  );
}

/**
 * Render a composition client-side using WebCodecs + Canvas.
 *
 * Runs on the main thread because OfflineAudioContext (needed for audio mixing)
 * is not available in Web Workers. Video decode/encode still uses hardware
 * acceleration via WebCodecs.
 */
export async function renderCompositionClient(
  opts: ClientRenderOptions,
  onProgress: (progress: RenderProgress) => void
): Promise<Blob> {
  const { render } = await import('./renderer');
  return render(opts, onProgress);
}
