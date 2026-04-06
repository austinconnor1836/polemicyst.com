/**
 * Extract thumbnail frames from a local video file using <video> + canvas.
 * Used for client-side thumbnail generation when source files haven't been
 * uploaded to S3 (so server-side frame extraction isn't available).
 */

export interface ExtractedFrame {
  blob: Blob;
  blobUrl: string;
  timestampS: number;
}

/**
 * Extract evenly-spaced frames from a video file.
 * @param file - The source video File
 * @param count - Number of frames to extract (default 6)
 * @param width - Output frame width (default 1280 to match thumbnail resolution, maintains aspect ratio)
 * @returns Array of extracted frames with blob URLs and timestamps
 */
export async function extractFrames(
  file: File,
  count = 6,
  width = 1280
): Promise<ExtractedFrame[]> {
  const blobUrl = URL.createObjectURL(file);

  try {
    const video = document.createElement('video');
    video.muted = true;
    video.preload = 'auto';
    video.src = blobUrl;

    // Wait for metadata to load
    await new Promise<void>((resolve, reject) => {
      video.onloadedmetadata = () => resolve();
      video.onerror = () => reject(new Error('Failed to load video metadata'));
      // Timeout after 10s
      setTimeout(() => reject(new Error('Video metadata load timeout')), 10_000);
    });

    const duration = video.duration;
    if (!duration || !isFinite(duration) || duration <= 0) {
      throw new Error('Video has no valid duration');
    }

    // Calculate evenly-spaced timestamps (skip first/last 5% to avoid black frames)
    const startPct = 0.05;
    const endPct = 0.95;
    const usableDuration = duration * (endPct - startPct);
    const step = usableDuration / (count - 1);
    const timestamps = Array.from({ length: count }, (_, i) =>
      Math.min(duration * startPct + i * step, duration - 0.1)
    );

    // Calculate canvas dimensions maintaining aspect ratio
    const aspectRatio = video.videoWidth / video.videoHeight;
    const canvasW = width;
    const canvasH = Math.round(width / aspectRatio);

    const canvas = document.createElement('canvas');
    canvas.width = canvasW;
    canvas.height = canvasH;
    const ctx = canvas.getContext('2d')!;

    const frames: ExtractedFrame[] = [];

    for (const ts of timestamps) {
      // Seek to timestamp and wait for a fully decoded frame
      video.currentTime = ts;
      await new Promise<void>((resolve) => {
        video.onseeked = () => {
          // requestVideoFrameCallback ensures a fully decoded frame is ready for drawing
          if ('requestVideoFrameCallback' in video) {
            (video as any).requestVideoFrameCallback(() => resolve());
          } else {
            resolve();
          }
        };
        // Fallback timeout in case onseeked never fires
        setTimeout(resolve, 3000);
      });

      // Draw frame to canvas
      ctx.drawImage(video, 0, 0, canvasW, canvasH);

      // Convert to blob
      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
          'image/jpeg',
          0.92
        );
      });

      frames.push({
        blob,
        blobUrl: URL.createObjectURL(blob),
        timestampS: ts,
      });
    }

    return frames;
  } finally {
    URL.revokeObjectURL(blobUrl);
  }
}
