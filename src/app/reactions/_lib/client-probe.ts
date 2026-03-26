/**
 * Probe a video file in the browser using an <video> element to extract
 * duration, dimensions, and whether it has audio.
 */
export interface ClientProbeResult {
  durationS: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export function probeVideoFile(file: File): Promise<ClientProbeResult> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const cleanup = () => {
      video.removeAttribute('src');
      video.load();
      URL.revokeObjectURL(url);
    };

    video.onloadedmetadata = () => {
      const result: ClientProbeResult = {
        durationS: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
        // Best-effort audio detection — browsers expose audioTracks on
        // HTMLVideoElement when the AudioTrack API is available.
        hasAudio: 'audioTracks' in video ? (video as any).audioTracks.length > 0 : true, // assume audio present when API unavailable
      };
      cleanup();
      resolve(result);
    };

    video.onerror = () => {
      cleanup();
      reject(new Error('Failed to probe video file'));
    };

    video.src = url;
  });
}
