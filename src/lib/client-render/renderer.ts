/**
 * Main render orchestrator.
 * Coordinates demuxing, decoding, compositing, encoding, and muxing.
 *
 * ARCHITECTURE: Uses a continuous-feed pipeline where samples are fed to the
 * VideoDecoder without intermediate flush() calls. H.264 decoders require
 * reference frames from previous samples (DPB), and flush() clears the DPB,
 * breaking decode of subsequent P/B-frames. Instead, we feed samples
 * on-demand and yield to the event loop to collect output frames.
 *
 * Memory: decoded VideoFrames are immediately snapshotted to OffscreenCanvas
 * in the decoder output callback, freeing GPU textures back to the decoder's
 * limited pool (~16-32). This prevents texture recycling that causes glitchy output.
 */
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';
import { demuxFile, type DemuxedTrack, type VideoSampleWithDts } from './demuxer';
import { compositeFrame, findActiveTrack } from './compositor';
import { mixAudio } from './audio-mixer';
import { getVideoEncoderConfig, getAudioEncoderConfig } from './encoder';
import {
  type ClientRenderOptions,
  type RenderProgress,
  type DecodedFrame,
  MOBILE_CANVAS_W,
  MOBILE_CANVAS_H,
  LANDSCAPE_CANVAS_W,
  LANDSCAPE_CANVAS_H,
  TARGET_FPS,
} from './types';

/**
 * On-demand video decoder that feeds samples without flush() until the end.
 * This preserves the H.264 reference picture buffer across the entire decode.
 */
class OnDemandDecoder {
  private decoder: VideoDecoder;
  private samples: VideoSampleWithDts[];
  private nextSampleIdx = 0;
  private frameQueue: DecodedFrame[] = [];
  private errorCount = 0;
  private decodeCount = 0;
  private outputCount = 0;
  private label: string;

  constructor(config: VideoDecoderConfig, samples: VideoSampleWithDts[], label = 'video') {
    this.samples = samples;
    this.label = label;
    this.decoder = new VideoDecoder({
      output: (frame) => {
        // Immediately snapshot the VideoFrame to an OffscreenCanvas and
        // close the VideoFrame. This frees the GPU texture back to the
        // decoder's limited pool (~16-32 textures). Without this, the pool
        // exhausts and Chrome recycles textures → garbled pixels.
        const w = frame.displayWidth;
        const h = frame.displayHeight;
        const snap = new OffscreenCanvas(w, h);
        const ctx = snap.getContext('2d')!;
        ctx.drawImage(frame, 0, 0, w, h);
        const ts = frame.timestamp;
        frame.close(); // Return texture to decoder pool immediately

        this.outputCount++;
        this.frameQueue.push({ source: snap, timestamp: ts, displayWidth: w, displayHeight: h });
      },
      error: (err) => {
        this.errorCount++;
        if (this.errorCount <= 5) {
          console.error(`[OnDemandDecoder:${this.label}] decode error #${this.errorCount}:`, err);
        }
      },
    });
    this.decoder.configure(config);
    console.log(
      `[OnDemandDecoder:${label}] configured: state=${this.decoder.state}, ` +
        `codec=${config.codec}, ${config.codedWidth}x${config.codedHeight}, ` +
        `samples=${samples.length}, hasDescription=${!!config.description}`
    );
    if (config.description) {
      // Correctly read the description bytes respecting typed array views
      let descBytes: Uint8Array;
      if (config.description instanceof ArrayBuffer) {
        descBytes = new Uint8Array(config.description);
      } else {
        const view = config.description as ArrayBufferView;
        descBytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
      }
      console.log(
        `[OnDemandDecoder:${label}] description (${descBytes.length} bytes) first 16: ` +
          Array.from(descBytes.slice(0, 16))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ')
      );
    }
  }

  /**
   * Feed samples up to targetUs (compared against DTS, not PTS).
   * Samples MUST be in DTS order — H.264 decoders require this for correct
   * B-frame reference picture management. Using PTS order causes B-frames
   * to be fed before their reference I/P frames, producing corrupt output.
   */
  async feedUpTo(targetUs: number): Promise<void> {
    // Don't try to feed a closed/errored decoder
    if (this.decoder.state !== 'configured') return;

    const prevCount = this.decodeCount;

    // Ensure we always feed at least the first sample even if targetUs=0
    const effectiveTargetUs =
      this.nextSampleIdx === 0 && this.samples.length > 0
        ? Math.max(targetUs, this.samples[0].dtsUs)
        : targetUs;

    while (this.nextSampleIdx < this.samples.length) {
      const sample = this.samples[this.nextSampleIdx];
      // Compare DTS (monotonically increasing) not PTS (non-monotonic with B-frames)
      if (sample.dtsUs > effectiveTargetUs) break;

      try {
        this.decoder.decode(sample.chunk);
        this.decodeCount++;
      } catch (err) {
        if (this.errorCount <= 3) {
          console.error(
            `[OnDemandDecoder:${this.label}] decode() threw at sample #${this.nextSampleIdx}, ` +
              `state=${this.decoder.state}:`,
            err
          );
        }
        this.errorCount++;
        if (this.decoder.state !== 'configured') {
          console.error(
            `[OnDemandDecoder:${this.label}] decoder closed after ${this.decodeCount} decoded, ` +
              `${this.outputCount} output, ${this.errorCount} errors`
          );
          return;
        }
      }
      this.nextSampleIdx++;

      // Backpressure: keep the hardware decoder queue bounded.
      // Without this, feeding faster than the decoder processes causes
      // queue overflow → errors → decoder closes after ~37k frames.
      if (this.decoder.decodeQueueSize > 15) {
        while (this.decoder.decodeQueueSize > 5 && this.decoder.state === 'configured') {
          await new Promise<void>((r) => setTimeout(r, 1));
        }
      }
    }

    const fedThisCall = this.decodeCount - prevCount;

    // Wait on the first feed to confirm the decoder is working.
    // After that, the 3s lookahead ensures frames are decoded before needed.
    // Post-feed backpressure (above) keeps the queue bounded on all feeds.
    if (fedThisCall > 0 && this.outputCount === 0) {
      let waitMs = 0;
      const MAX_WAIT_MS = 2000;
      while (waitMs < MAX_WAIT_MS && this.outputCount === 0) {
        await new Promise<void>((r) => setTimeout(r, 5));
        waitMs += 5;
        if (this.decoder.state !== 'configured') break;
      }

      console.log(
        `[OnDemandDecoder:${this.label}] First feed: ${fedThisCall} samples ` +
          `(first DTS=${this.samples[0]?.dtsUs}µs, first PTS=${this.samples[0]?.chunk.timestamp}µs), ` +
          `${this.outputCount} output frames, decoder.state=${this.decoder.state}, ` +
          `queueSize=${this.decoder.decodeQueueSize}, errors=${this.errorCount}, waited=${waitMs}ms`
      );
      if (this.outputCount === 0 && this.errorCount === 0) {
        console.warn(
          `[OnDemandDecoder:${this.label}] WARNING: 0 output frames and 0 errors after first feed.`
        );
      }
    }
  }

  /**
   * Get the nearest decoded frame to targetUs and discard older frames.
   * Frames are OffscreenCanvas snapshots (not GPU-backed VideoFrames),
   * so no close() is needed — they're GC'd normally.
   */
  consumeFrame(targetUs: number): DecodedFrame | null {
    if (this.frameQueue.length === 0) return null;

    // Find the frame closest to targetUs
    let bestIdx = 0;
    let bestDiff = Math.abs(this.frameQueue[0].timestamp - targetUs);

    for (let i = 1; i < this.frameQueue.length; i++) {
      const diff = Math.abs(this.frameQueue[i].timestamp - targetUs);
      if (diff < bestDiff) {
        bestDiff = diff;
        bestIdx = i;
      }
    }

    // Discard older frames (GC will reclaim the OffscreenCanvases)
    if (bestIdx > 0) {
      this.frameQueue.splice(0, bestIdx);
    }

    // Remove and return the selected frame (now at index 0)
    return this.frameQueue.shift()!;
  }

  /**
   * Flush remaining samples and close the decoder.
   */
  async finish(): Promise<void> {
    if (this.decoder.state === 'configured') {
      await this.decoder.flush();
    }
    if (this.decoder.state !== 'closed') {
      this.decoder.close();
    }
    this.frameQueue = []; // OffscreenCanvases are GC'd
    console.log(
      `[OnDemandDecoder:${this.label}] finished: ` +
        `decoded=${this.decodeCount}, output=${this.outputCount}, errors=${this.errorCount}`
    );
  }

  get stats() {
    return {
      decoded: this.decodeCount,
      output: this.outputCount,
      errors: this.errorCount,
      queuedFrames: this.frameQueue.length,
    };
  }
}

/**
 * Render a composition client-side using WebCodecs + Canvas.
 */
export async function render(
  opts: ClientRenderOptions,
  onProgress: (progress: RenderProgress) => void
): Promise<Blob> {
  const isMobile = opts.layout === 'mobile';
  const canvasW = isMobile ? MOBILE_CANVAS_W : LANDSCAPE_CANVAS_W;
  const canvasH = isMobile ? MOBILE_CANVAS_H : LANDSCAPE_CANVAS_H;

  onProgress({ phase: 'preparing', percent: 0, message: 'Setting up renderer...' });

  // --- 1. Demux all source files FIRST to get authoritative duration ---
  onProgress({ phase: 'demuxing', percent: 0, message: 'Demuxing creator video...' });

  const creatorDemuxed = await demuxFile(
    opts.creatorFile,
    opts.creatorTrimStartS,
    opts.creatorTrimEndS
  );

  // Use demuxed duration as authoritative source (probeVideo may timeout for large files)
  const creatorDurationS = opts.creatorDurationS || creatorDemuxed.durationS;

  // Calculate output duration
  const creatorTrimEnd = opts.creatorTrimEndS ?? creatorDurationS;
  const outputDurationS = creatorTrimEnd - opts.creatorTrimStartS;
  const totalFrames = Math.ceil(outputDurationS * TARGET_FPS);

  console.log(
    `[renderer] Setup: layout=${opts.layout}, trimStart=${opts.creatorTrimStartS}s, ` +
      `trimEnd=${opts.creatorTrimEndS ?? 'null'}s, ` +
      `duration=${creatorDurationS}s (opts=${opts.creatorDurationS}, demuxed=${creatorDemuxed.durationS}), ` +
      `outputDuration=${outputDurationS.toFixed(2)}s, totalFrames=${totalFrames}`
  );

  const refDemuxed: DemuxedTrack[] = [];
  for (let i = 0; i < opts.tracks.length; i++) {
    const track = opts.tracks[i];
    onProgress({
      phase: 'demuxing',
      percent: Math.round(((i + 1) / (opts.tracks.length + 1)) * 100),
      message: `Demuxing reference ${i + 1}...`,
    });
    const demuxed = await demuxFile(track.file, track.trimStartS, track.trimEndS);
    refDemuxed.push(demuxed);
  }

  // Fix ref track durationS from demuxed data (probeVideo may timeout for large files)
  for (let i = 0; i < opts.tracks.length; i++) {
    if ((!opts.tracks[i].durationS || opts.tracks[i].durationS === 0) && refDemuxed[i]) {
      console.log(
        `[renderer] Track ${i} durationS was ${opts.tracks[i].durationS}, ` +
          `updated from demuxed: ${refDemuxed[i].durationS}s`
      );
      opts.tracks[i].durationS = refDemuxed[i].durationS;
    }
  }

  console.log(
    `[renderer] Demuxed: creator=${creatorDemuxed.videoSamples.length} video samples, ` +
      `refs=${refDemuxed.map((r) => r.videoSamples.length).join(',')}`
  );

  if (creatorDemuxed.videoSamples.length === 0) {
    throw new Error(
      `No creator video samples after demuxing. Codec: ${creatorDemuxed.videoCodecConfig.codec}`
    );
  }

  // --- 1.5. Verify codec support ---
  const configCheck = await VideoDecoder.isConfigSupported(creatorDemuxed.videoCodecConfig);
  console.log(
    `[renderer] VideoDecoder.isConfigSupported: supported=${configCheck.supported}, ` +
      `codec=${creatorDemuxed.videoCodecConfig.codec}`
  );
  if (!configCheck.supported) {
    throw new Error(
      `Browser does not support decoding codec ${creatorDemuxed.videoCodecConfig.codec}. ` +
        'Falling back to server-side render.'
    );
  }

  // --- 2. Set up muxer ---
  onProgress({ phase: 'rendering', percent: 0, message: 'Initializing encoder...' });

  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: canvasW,
      height: canvasH,
    },
    audio: {
      codec: 'aac',
      sampleRate: 44100,
      numberOfChannels: 2,
    },
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  // --- 3. Continuous decode + composite + encode ---
  const canvas = new OffscreenCanvas(canvasW, canvasH);
  const canvasCtx = canvas.getContext('2d');
  if (!canvasCtx) {
    throw new Error('Failed to get OffscreenCanvas 2D context');
  }

  // Set up decoders (no flush between frames — continuous decode)
  const creatorDecoder = new OnDemandDecoder(
    creatorDemuxed.videoCodecConfig,
    creatorDemuxed.videoSamples,
    'creator'
  );

  const refDecoders = refDemuxed.map((ref, i) =>
    ref.videoSamples.length > 0
      ? new OnDemandDecoder(ref.videoCodecConfig, ref.videoSamples, `ref-${i}`)
      : null
  );

  // Set up video encoder
  const videoEncoderConfig = getVideoEncoderConfig(opts.layout);
  const videoEncoder = new VideoEncoder({
    output: (chunk, meta) => {
      muxer.addVideoChunk(chunk, meta ?? undefined);
    },
    error: (err) => console.error('[renderer] Video encoder error:', err),
  });
  videoEncoder.configure(videoEncoderConfig);

  // --- Process each output frame ---
  let totalEncodedFrames = 0;
  const PROGRESS_INTERVAL = 30; // Report progress every 30 frames
  // Feed 1 second ahead — enough for H.264 B-frame reordering while keeping
  // GPU memory bounded. At 60fps source, 1s = ~60 decoded frames × ~8MB = ~480MB
  // per decoder. Larger lookahead wastes GPU texture memory and causes corruption.
  const DECODE_AHEAD_US = 1_000_000;

  for (let frameIdx = 0; frameIdx < totalFrames; frameIdx++) {
    const outputTimeS = frameIdx / TARGET_FPS;
    const outputTimeUs = Math.round(outputTimeS * 1_000_000);
    const sourceTimeS = outputTimeS;
    const sourceTimeUs = outputTimeUs;

    // Feed creator samples ahead of current time for B-frame reordering
    await creatorDecoder.feedUpTo(sourceTimeUs + DECODE_AHEAD_US);

    // Find the active reference track (uses source time for correct track placement)
    const activeRef = findActiveTrack(opts.tracks, sourceTimeS);
    let refFrame: DecodedFrame | null = null;

    if (activeRef) {
      const refDecoder = refDecoders[activeRef.trackIndex];
      if (refDecoder) {
        const track = opts.tracks[activeRef.trackIndex];
        const refLocalTimeUs = Math.round((activeRef.trackTimeS - track.trimStartS) * 1_000_000);
        await refDecoder.feedUpTo(refLocalTimeUs + DECODE_AHEAD_US);
        refFrame = refDecoder.consumeFrame(refLocalTimeUs);
      }
    }

    const creatorFrame = creatorDecoder.consumeFrame(sourceTimeUs);

    // Log first frame diagnostics
    if (frameIdx === 0) {
      const stats = creatorDecoder.stats;
      console.log(
        `[renderer] Frame 0: creatorFrame=${!!creatorFrame}, refFrame=${!!refFrame}, ` +
          `creatorStats=${JSON.stringify(stats)}`
      );
    }

    if (creatorFrame) {
      compositeFrame(
        canvas,
        creatorFrame,
        refFrame,
        opts.layout,
        activeRef ? opts.tracks[activeRef.trackIndex] : null,
        outputTimeS,
        opts.captions,
        opts.quoteOverlays
      );

      // Diagnostic: dump first composited frame as PNG to console for inspection
      if (frameIdx === 0) {
        try {
          const blob = await canvas.convertToBlob({ type: 'image/png' });
          const url = URL.createObjectURL(blob);
          console.log(
            `[renderer] DIAGNOSTIC: First composited frame (${canvas.width}x${canvas.height}): ${url}`
          );
          console.log('[renderer] Open the URL above in a new tab to verify compositing quality');
        } catch {
          console.warn('[renderer] Could not create diagnostic PNG');
        }
      }

      try {
        // transferToImageBitmap() atomically snapshots the canvas content,
        // guaranteeing all drawImage operations are complete. Avoids potential
        // race where new VideoFrame(canvas) captures stale GPU state.
        const bitmap = canvas.transferToImageBitmap();
        const outputFrame = new VideoFrame(bitmap, {
          timestamp: outputTimeUs,
          duration: Math.round(1_000_000 / TARGET_FPS),
        });
        bitmap.close();

        const isKeyFrame = frameIdx % (TARGET_FPS * 2) === 0;
        videoEncoder.encode(outputFrame, { keyFrame: isKeyFrame });
        outputFrame.close();
        totalEncodedFrames++;

        // Encoder backpressure: don't outrun the hardware encoder
        if (videoEncoder.encodeQueueSize > 20) {
          while (videoEncoder.encodeQueueSize > 5) {
            await new Promise<void>((r) => setTimeout(r, 1));
          }
        }
      } catch (err) {
        if (frameIdx === 0) {
          console.error('[renderer] Failed to create VideoFrame from canvas:', err);
          throw err;
        }
      }
    }

    // Report progress and yield to event loop for UI responsiveness.
    // The render runs on the main thread (OfflineAudioContext requires it),
    // so without yields React can't re-render the progress bar.
    if (frameIdx % PROGRESS_INTERVAL === 0 || frameIdx === totalFrames - 1) {
      onProgress({
        phase: 'rendering',
        percent: Math.round(((frameIdx + 1) / totalFrames) * 100),
        currentFrame: frameIdx + 1,
        totalFrames,
        message: `Rendering frame ${frameIdx + 1}/${totalFrames}`,
      });
      // Yield to event loop so React can paint the progress update
      await new Promise<void>((r) => setTimeout(r, 0));
    }

    // Console progress every ~30 seconds of video
    if (frameIdx > 0 && frameIdx % 900 === 0) {
      console.log(
        `[renderer] Progress: ${frameIdx}/${totalFrames} frames ` +
          `(${Math.round((frameIdx / totalFrames) * 100)}%)`
      );
    }
  }

  await videoEncoder.flush();
  videoEncoder.close();

  console.log(`[renderer] Video encoding complete: ${totalEncodedFrames} frames encoded`);

  // Finish decoders
  await creatorDecoder.finish();
  for (const decoder of refDecoders) await decoder?.finish();

  if (totalEncodedFrames === 0) {
    throw new Error(
      'No video frames were encoded. The video decoder may not support this codec. ' +
        `Codec: ${creatorDemuxed.videoCodecConfig.codec}`
    );
  }

  // Free video samples from memory (keep audio samples for mixing)
  creatorDemuxed.videoSamples.length = 0;
  for (const ref of refDemuxed) {
    ref.videoSamples.length = 0;
  }

  // --- 4. Mix and encode audio ---
  // Uses demuxed EncodedAudioChunks (~21 MB) instead of re-reading entire files
  // (~3.3 GB for two 1.66 GB files), preventing OOM crashes.
  onProgress({ phase: 'encoding-audio', percent: 0, message: 'Mixing audio...' });

  const audioBuffer = await mixAudio({
    creatorAudio: creatorDemuxed.audioCodecConfig
      ? { config: creatorDemuxed.audioCodecConfig, samples: creatorDemuxed.audioSamples }
      : null,
    creatorVolume: opts.creatorVolume,
    refAudio: refDemuxed.map((ref) =>
      ref.audioCodecConfig ? { config: ref.audioCodecConfig, samples: ref.audioSamples } : null
    ),
    tracks: opts.tracks,
    referenceVolume: opts.referenceVolume,
    audioMode: opts.audioMode,
    outputDurationS,
  });

  // Now free audio samples
  creatorDemuxed.audioSamples.length = 0;
  for (const ref of refDemuxed) {
    ref.audioSamples.length = 0;
  }

  onProgress({ phase: 'encoding-audio', percent: 50, message: 'Encoding audio...' });

  const audioEncoder = new AudioEncoder({
    output: (chunk, meta) => {
      muxer.addAudioChunk(chunk, meta ?? undefined);
    },
    error: (err) => console.error('[renderer] Audio encoder error:', err),
  });
  audioEncoder.configure(getAudioEncoderConfig());

  const FRAME_SIZE = 1024;
  const totalAudioFrames = Math.ceil(audioBuffer.length / FRAME_SIZE);

  for (let i = 0; i < totalAudioFrames; i++) {
    const offset = i * FRAME_SIZE;
    const length = Math.min(FRAME_SIZE, audioBuffer.length - offset);

    const data = new Float32Array(length * audioBuffer.numberOfChannels);
    for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
      const channelData = audioBuffer.getChannelData(ch);
      data.set(channelData.subarray(offset, offset + length), ch * length);
    }

    const audioData = new AudioData({
      format: 'f32-planar',
      sampleRate: audioBuffer.sampleRate,
      numberOfFrames: length,
      numberOfChannels: audioBuffer.numberOfChannels,
      timestamp: Math.round((offset / audioBuffer.sampleRate) * 1_000_000),
      data,
    });

    audioEncoder.encode(audioData);
    audioData.close();
  }

  await audioEncoder.flush();
  audioEncoder.close();

  // --- 5. Finalize muxer ---
  onProgress({ phase: 'muxing', percent: 0, message: 'Finalizing MP4...' });

  muxer.finalize();

  const mp4Buffer = muxerTarget.buffer;
  const blob = new Blob([mp4Buffer], { type: 'video/mp4' });

  onProgress({
    phase: 'complete',
    percent: 100,
    message: `Done! Output: ${(blob.size / (1024 * 1024)).toFixed(1)} MB`,
  });

  return blob;
}
