/**
 * Client-side video metadata extraction using HTML5 video element.
 * Returns duration, width, and height from a blob URL without any server round-trip.
 */
export function probeVideo(
  blobUrl: string,
  timeoutMs = 5000
): Promise<{ durationS: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;

    const timer = setTimeout(() => {
      cleanup();
      // Return sensible defaults on timeout rather than failing
      resolve({ durationS: 0, width: 1920, height: 1080 });
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timer);
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
      video.src = '';
      video.load();
    }

    function onLoaded() {
      cleanup();
      resolve({
        durationS: video.duration && isFinite(video.duration) ? video.duration : 0,
        width: video.videoWidth || 1920,
        height: video.videoHeight || 1080,
      });
    }

    function onError() {
      cleanup();
      resolve({ durationS: 0, width: 1920, height: 1080 });
    }

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);
    video.src = blobUrl;
  });
}
