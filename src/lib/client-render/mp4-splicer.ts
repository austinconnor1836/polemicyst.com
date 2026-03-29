/**
 * Lossless MP4 splicer — remux an already-rendered MP4, keeping only
 * the specified time segments. No decode/encode, so it's instant.
 *
 * Algorithm:
 *   1. Demux the blob via mp4box.js → collect raw samples + codec configs
 *   2. Filter samples to kept segments (snap video to preceding keyframe)
 *   3. Re-timestamp to be continuous
 *   4. Remux via mp4-muxer → return new Blob
 */
import {
  createFile,
  DataStream,
  Endianness,
  type ISOFile,
  type Movie,
  type Sample,
  type MP4BoxBuffer,
} from 'mp4box';
import { Muxer, ArrayBufferTarget } from 'mp4-muxer';

/** A raw sample extracted from the source MP4. */
interface RawSample {
  data: Uint8Array;
  /** Composition (presentation) timestamp in seconds */
  ctsS: number;
  /** Decode timestamp in seconds */
  dtsS: number;
  /** Duration in seconds */
  durationS: number;
  isSync: boolean;
}

interface DemuxResult {
  videoSamples: RawSample[];
  audioSamples: RawSample[];
  videoCodec: string;
  audioCodec: string;
  width: number;
  height: number;
  sampleRate: number;
  numberOfChannels: number;
  videoDescription?: Uint8Array;
  durationS: number;
}

/**
 * Subtracts cut ranges from [start, end], returns the remaining segments.
 */
export function computeKeptSegments(
  start: number,
  end: number,
  cuts: Array<{ startS: number; endS: number }>
): Array<{ startS: number; endS: number }> {
  const sorted = [...cuts].sort((a, b) => a.startS - b.startS);
  const segments: Array<{ startS: number; endS: number }> = [];
  let cursor = start;

  for (const cut of sorted) {
    const cutStart = Math.max(cut.startS, start);
    const cutEnd = Math.min(cut.endS, end);
    if (cutStart >= cutEnd) continue;
    if (cutStart < cursor) continue;

    if (cursor < cutStart) {
      segments.push({ startS: cursor, endS: cutStart });
    }
    cursor = Math.max(cursor, cutEnd);
  }

  if (cursor < end) {
    segments.push({ startS: cursor, endS: end });
  }

  return segments;
}

/** Demux a Blob into raw samples via mp4box.js */
async function demuxBlob(blob: Blob): Promise<DemuxResult> {
  return new Promise((resolve, reject) => {
    const mp4File = createFile(true);
    let videoTrackId: number | null = null;
    let audioTrackId: number | null = null;
    let videoTimescale = 0;
    let audioTimescale = 0;
    const videoSamples: RawSample[] = [];
    const audioSamples: RawSample[] = [];
    let width = 0;
    let height = 0;
    let videoCodec = '';
    let audioCodec = '';
    let sampleRate = 44100;
    let numberOfChannels = 2;
    let videoDescription: Uint8Array | undefined;
    let totalDuration = 0;
    let readComplete = false;

    function tryResolve() {
      if (!readComplete) return;
      resolve({
        videoSamples,
        audioSamples,
        videoCodec,
        audioCodec,
        width,
        height,
        sampleRate,
        numberOfChannels,
        videoDescription,
        durationS: totalDuration,
      });
    }

    mp4File.onReady = (info: Movie) => {
      totalDuration = info.duration / info.timescale;

      const vt = info.videoTracks[0];
      if (vt) {
        videoTrackId = vt.id;
        videoTimescale = vt.timescale;
        width = vt.track_width;
        height = vt.track_height;
        videoCodec = vt.codec;
        videoDescription = getDescription(mp4File, vt.id);
        mp4File.setExtractionOptions(vt.id, 'video', { nbSamples: 1000 });
      }

      const at = info.audioTracks[0];
      if (at) {
        audioTrackId = at.id;
        audioTimescale = at.timescale;
        audioCodec = at.codec;
        sampleRate = at.audio?.sample_rate ?? 44100;
        numberOfChannels = at.audio?.channel_count ?? 2;
        mp4File.setExtractionOptions(at.id, 'audio', { nbSamples: 1000 });
      }

      mp4File.start();
    };

    mp4File.onSamples = (trackId: number, _ref: unknown, samples: Sample[]) => {
      for (const sample of samples) {
        if (!sample.data) continue;
        // Copy the data so mp4box can release its buffers.
        // sample.data is a Uint8Array VIEW into a shared mdat buffer —
        // we must respect byteOffset/byteLength, not copy the whole buffer.
        const src = sample.data as BufferSource;
        const data = ArrayBuffer.isView(src)
          ? new Uint8Array(src.buffer, src.byteOffset, src.byteLength).slice()
          : new Uint8Array(src as ArrayBuffer).slice();

        if (trackId === videoTrackId) {
          videoSamples.push({
            data,
            ctsS: sample.cts / videoTimescale,
            dtsS: sample.dts / videoTimescale,
            durationS: sample.duration / videoTimescale,
            isSync: sample.is_sync,
          });
        } else if (trackId === audioTrackId) {
          audioSamples.push({
            data,
            ctsS: sample.cts / audioTimescale,
            dtsS: sample.dts / audioTimescale,
            durationS: sample.duration / audioTimescale,
            isSync: sample.is_sync,
          });
        }
      }

      // Release processed samples
      // eslint-disable-next-line
      const f = mp4File as any;
      if (f.releaseUsedSamples) {
        f.releaseUsedSamples(trackId, samples.length);
      }
    };

    mp4File.onError = (e: string) => reject(new Error(`MP4Box demux error: ${e}`));

    // Stream the blob through mp4box
    const reader = blob.stream().getReader();
    let offset = 0;

    (async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            mp4File.flush();
            readComplete = true;
            tryResolve();
            break;
          }
          const copy = new Uint8Array(value).buffer as ArrayBuffer & { fileStart: number };
          copy.fileStart = offset;
          offset += value.byteLength;
          mp4File.appendBuffer(copy as unknown as MP4BoxBuffer);
        }
      } catch (err) {
        reject(err);
      }
    })();
  });
}

/** Get codec description box (avcC, hvcC, etc.) — same as demuxer.ts */
function getDescription(mp4File: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = mp4File.getTrackById(trackId);
  if (!trak) return undefined;

  // eslint-disable-next-line
  const stbl = (trak as any).mdia?.minf?.stbl;
  if (!stbl?.stsd?.entries?.length) return undefined;

  const entry = stbl.stsd.entries[0];
  const descBox = entry.avcC || entry.hvcC || entry.vpcC;
  if (!descBox) return undefined;

  const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
  descBox.write(stream);
  return new Uint8Array((stream.buffer as ArrayBuffer).slice(8));
}

/**
 * Losslessly splice an MP4 blob, keeping only the given time segments.
 *
 * @param blob        - Source MP4 blob (already rendered)
 * @param keptSegments - Time ranges to keep, in seconds [{startS, endS}, ...]
 * @param onProgress  - Optional progress callback (0-100)
 * @returns A new MP4 Blob with only the kept segments
 */
export async function spliceMP4(
  blob: Blob,
  keptSegments: Array<{ startS: number; endS: number }>,
  onProgress?: (percent: number) => void
): Promise<Blob> {
  onProgress?.(0);

  console.log(
    `[spliceMP4] Starting: blob=${(blob.size / 1024 / 1024).toFixed(1)}MB, ` +
      `keptSegments=${JSON.stringify(keptSegments)}`
  );

  // 1. Demux
  const demuxed = await demuxBlob(blob);
  console.log(
    `[spliceMP4] Demuxed: ${demuxed.videoSamples.length} video samples, ` +
      `${demuxed.audioSamples.length} audio samples, ` +
      `duration=${demuxed.durationS.toFixed(2)}s, ${demuxed.width}x${demuxed.height}, ` +
      `videoCodec=${demuxed.videoCodec}, audioCodec=${demuxed.audioCodec}, ` +
      `hasDescription=${!!demuxed.videoDescription}`
  );

  if (demuxed.videoSamples.length === 0) {
    throw new Error('Demux produced 0 video samples — cannot splice');
  }

  // Log keyframe positions for debugging
  const keyframes = demuxed.videoSamples.filter((s) => s.isSync).map((s) => s.ctsS.toFixed(2));
  console.log(
    `[spliceMP4] Keyframes at: [${keyframes.slice(0, 20).join(', ')}${keyframes.length > 20 ? '...' : ''}] ` +
      `(${keyframes.length} total)`
  );

  onProgress?.(30);

  // 2. Pre-compute keyframe snap points for each segment.
  //    Video must snap to the preceding keyframe; audio uses the same snap
  //    so that audio and video stay in sync.
  const snappedSegments = keptSegments.map((seg) => {
    let snapStartS = seg.startS;
    for (let i = demuxed.videoSamples.length - 1; i >= 0; i--) {
      const s = demuxed.videoSamples[i];
      if (s.isSync && s.ctsS <= seg.startS) {
        snapStartS = s.ctsS;
        break;
      }
    }
    return { ...seg, snapStartS };
  });

  // 3. Filter + re-timestamp video samples
  const filteredVideo: Array<RawSample & { newCtsUs: number; newDtsUs: number }> = [];
  let outputOffsetS = 0;

  for (const seg of snappedSegments) {
    const beforeCount = filteredVideo.length;
    for (const s of demuxed.videoSamples) {
      if (s.ctsS < seg.snapStartS || s.ctsS >= seg.endS) continue;
      const newCtsS = outputOffsetS + (s.ctsS - seg.snapStartS);
      const newDtsS = outputOffsetS + (s.dtsS - seg.snapStartS);
      filteredVideo.push({
        ...s,
        newCtsUs: Math.round(newCtsS * 1_000_000),
        newDtsUs: Math.round(newDtsS * 1_000_000),
      });
    }
    const addedCount = filteredVideo.length - beforeCount;
    console.log(
      `[spliceMP4] Segment [${seg.startS.toFixed(2)}, ${seg.endS.toFixed(2)}): ` +
        `snapStart=${seg.snapStartS.toFixed(2)}, added ${addedCount} video samples, ` +
        `outputOffset=${outputOffsetS.toFixed(2)}s`
    );
    outputOffsetS += seg.endS - seg.snapStartS;
  }

  console.log(
    `[spliceMP4] Filtered: ${filteredVideo.length} video, ` +
      `first keyframe=${filteredVideo.find((s) => s.isSync)?.newCtsUs ?? 'none'}µs`
  );

  onProgress?.(50);

  // 4. Filter + re-timestamp audio samples — use same snap points as video for sync
  const filteredAudio: Array<RawSample & { newCtsUs: number }> = [];
  outputOffsetS = 0;

  for (const seg of snappedSegments) {
    for (const s of demuxed.audioSamples) {
      if (s.ctsS < seg.snapStartS || s.ctsS >= seg.endS) continue;
      const newCtsS = outputOffsetS + (s.ctsS - seg.snapStartS);
      filteredAudio.push({
        ...s,
        newCtsUs: Math.round(newCtsS * 1_000_000),
      });
    }
    outputOffsetS += seg.endS - seg.snapStartS;
  }

  console.log(`[spliceMP4] Filtered audio: ${filteredAudio.length} samples`);

  onProgress?.(60);

  // 4. Remux with mp4-muxer
  const muxerTarget = new ArrayBufferTarget();
  const muxer = new Muxer({
    target: muxerTarget,
    video: {
      codec: 'avc',
      width: demuxed.width,
      height: demuxed.height,
    },
    audio: demuxed.audioCodec
      ? {
          codec: 'aac',
          sampleRate: demuxed.sampleRate,
          numberOfChannels: demuxed.numberOfChannels,
        }
      : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let addedDescription = false;
  for (let i = 0; i < filteredVideo.length; i++) {
    const s = filteredVideo[i];
    const meta =
      s.isSync && !addedDescription && demuxed.videoDescription
        ? { decoderConfig: { codec: demuxed.videoCodec, description: demuxed.videoDescription } }
        : undefined;
    if (meta) addedDescription = true;

    muxer.addVideoChunkRaw(
      s.data,
      s.isSync ? 'key' : 'delta',
      s.newCtsUs,
      Math.round(s.durationS * 1_000_000),
      meta
    );

    // Report progress through the video remux phase (60-90%)
    if (i % 100 === 0) {
      onProgress?.(60 + Math.round((i / filteredVideo.length) * 30));
    }
  }

  for (const s of filteredAudio) {
    muxer.addAudioChunkRaw(
      s.data,
      'key', // AAC frames are always keyframes
      s.newCtsUs,
      Math.round(s.durationS * 1_000_000)
    );
  }

  onProgress?.(95);

  muxer.finalize();
  const result = new Blob([muxerTarget.buffer], { type: 'video/mp4' });

  console.log(
    `[spliceMP4] Complete: ${(result.size / 1024 / 1024).toFixed(1)}MB ` +
      `(${filteredVideo.length} video + ${filteredAudio.length} audio samples)`
  );

  onProgress?.(100);
  return result;
}
