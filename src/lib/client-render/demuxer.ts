/**
 * MP4 demuxer using mp4box.js.
 * Extracts video and audio samples from MP4/MOV containers.
 */
import {
  createFile,
  DataStream,
  Endianness,
  MP4BoxBuffer,
  type ISOFile,
  type Movie,
  type Sample,
} from 'mp4box';

export interface VideoSampleWithDts {
  chunk: EncodedVideoChunk;
  dtsUs: number; // Decode timestamp — samples must be fed in DTS order
}

export interface DemuxedTrack {
  videoCodecConfig: VideoDecoderConfig;
  audioCodecConfig?: AudioDecoderConfig;
  videoSamples: VideoSampleWithDts[];
  audioSamples: EncodedAudioChunk[];
  durationS: number;
  width: number;
  height: number;
}

/**
 * Demux a File into video + audio samples.
 * Handles trim by filtering samples by timestamp.
 */
export async function demuxFile(
  file: File,
  trimStartS: number = 0,
  trimEndS: number | null = null
): Promise<DemuxedTrack> {
  return new Promise((resolve, reject) => {
    // keepMdatData=true so mp4box retains sample data for extraction
    const mp4File = createFile(true);
    let videoTrackId: number | null = null;
    let audioTrackId: number | null = null;
    let videoTimescale = 0;
    let audioTimescale = 0;
    let videoCodecConfig: VideoDecoderConfig | null = null;
    let audioCodecConfig: AudioDecoderConfig | null = null;
    const videoSamples: VideoSampleWithDts[] = [];
    const audioSamples: EncodedAudioChunk[] = [];
    let trackWidth = 0;
    let trackHeight = 0;
    let totalDuration = 0;
    let readComplete = false;

    function tryResolve() {
      if (!readComplete) return;

      if (!videoCodecConfig) {
        reject(
          new Error(
            'Demuxing failed: no video track detected. ' +
              'The file may not be a valid MP4/MOV container.'
          )
        );
        return;
      }

      // Video samples are kept in DTS order (as delivered by mp4box.js) —
      // H.264 decoders REQUIRE DTS order. Sorting by PTS breaks B-frame
      // decoding because B-frames would be fed before their reference I/P frames.
      // Audio has no B-frames, so PTS sort is safe.
      audioSamples.sort((a, b) => a.timestamp - b.timestamp);

      resolve({
        videoCodecConfig,
        audioCodecConfig: audioCodecConfig || undefined,
        videoSamples,
        audioSamples,
        durationS: totalDuration,
        width: trackWidth,
        height: trackHeight,
      });
    }

    mp4File.onReady = (info: Movie) => {
      totalDuration = info.duration / info.timescale;

      console.log(
        `[demuxer] onReady: duration=${totalDuration.toFixed(2)}s, ` +
          `videoTracks=${info.videoTracks.length}, audioTracks=${info.audioTracks.length}`
      );

      // Find video track
      const videoTrack = info.videoTracks[0];
      if (!videoTrack) {
        reject(new Error('No video track found'));
        return;
      }

      videoTrackId = videoTrack.id;
      videoTimescale = videoTrack.timescale;
      trackWidth = videoTrack.track_width;
      trackHeight = videoTrack.track_height;

      // Build VideoDecoderConfig
      const description = getDescription(mp4File, videoTrackId);
      videoCodecConfig = {
        codec: videoTrack.codec,
        codedWidth: videoTrack.track_width,
        codedHeight: videoTrack.track_height,
        ...(description ? { description } : {}),
      };

      console.log(
        `[demuxer] Video: id=${videoTrackId}, codec=${videoTrack.codec}, ` +
          `${trackWidth}x${trackHeight}, timescale=${videoTimescale}, ` +
          `hasDescription=${!!description}`
      );

      mp4File.setExtractionOptions(videoTrackId, 'video', {
        nbSamples: 500, // Process in batches
      });

      // Find audio track
      const audioTrack = info.audioTracks[0];
      if (audioTrack) {
        audioTrackId = audioTrack.id;
        audioTimescale = audioTrack.timescale;

        const audioDescription = getDescription(mp4File, audioTrackId);
        audioCodecConfig = {
          codec: audioTrack.codec,
          sampleRate: audioTrack.audio?.sample_rate ?? 44100,
          numberOfChannels: audioTrack.audio?.channel_count ?? 2,
          ...(audioDescription ? { description: audioDescription } : {}),
        };

        mp4File.setExtractionOptions(audioTrackId, 'audio', {
          nbSamples: 500,
        });
      }

      mp4File.start();
    };

    mp4File.onSamples = (trackId: number, _ref: unknown, samples: Sample[]) => {
      console.log(
        `[demuxer] onSamples: trackId=${trackId}, count=${samples.length}, ` +
          `hasData=${samples.length > 0 && !!samples[0].data}`
      );
      const effectiveEnd = trimEndS ?? totalDuration;

      for (const sample of samples) {
        if (trackId === videoTrackId) {
          const ptsS = sample.cts / videoTimescale;
          const dtsS = sample.dts / videoTimescale;

          // Skip samples outside trim range (use PTS for display-time filtering)
          if (ptsS < trimStartS || ptsS >= effectiveEnd) continue;

          if (!sample.data) continue;
          const chunk = new EncodedVideoChunk({
            type: sample.is_sync ? 'key' : 'delta',
            // timestamp = PTS (presentation time) for correct output ordering
            timestamp: Math.round((ptsS - trimStartS) * 1_000_000),
            duration: Math.round((sample.duration / videoTimescale) * 1_000_000),
            data: sample.data as BufferSource,
          });
          // Store DTS alongside — samples MUST be fed to decoder in DTS order.
          // mp4box.js delivers onSamples in DTS order (file order per MP4 spec).
          const dtsUs = Math.round((dtsS - trimStartS) * 1_000_000);
          videoSamples.push({ chunk, dtsUs });
        } else if (trackId === audioTrackId) {
          const timeS = sample.cts / audioTimescale;

          if (timeS < trimStartS || timeS >= effectiveEnd) continue;
          if (!sample.data) continue;

          const chunk = new EncodedAudioChunk({
            type: sample.is_sync ? 'key' : 'delta',
            timestamp: Math.round((timeS - trimStartS) * 1_000_000),
            duration: Math.round((sample.duration / audioTimescale) * 1_000_000),
            data: sample.data as BufferSource,
          });
          audioSamples.push(chunk);
        }
      }

      // Release processed samples from mp4box to free memory
      // eslint-disable-next-line
      const mp4FileAny = mp4File as any;
      if (mp4FileAny.releaseUsedSamples) {
        if (trackId === videoTrackId) {
          mp4FileAny.releaseUsedSamples(videoTrackId, samples.length);
        } else if (trackId === audioTrackId) {
          mp4FileAny.releaseUsedSamples(audioTrackId, samples.length);
        }
      }
    };

    mp4File.onError = (e: string) => {
      reject(new Error(`MP4Box error: ${e}`));
    };

    // Read the file and feed to mp4box using ArrayBuffer with fileStart property
    const reader = file.stream().getReader();
    let offset = 0;

    const readChunks = async () => {
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) {
            console.log(`[demuxer] Read complete: ${offset} bytes, flushing mp4box...`);
            mp4File.flush();
            readComplete = true;
            console.log(
              `[demuxer] After flush: ${videoSamples.length} video samples, ` +
                `${audioSamples.length} audio samples`
            );
            tryResolve();
            break;
          }

          // Copy to a fresh ArrayBuffer to avoid issues with Uint8Array views
          // into shared/offset buffers from the stream reader
          const copy = new Uint8Array(value).buffer as ArrayBuffer & {
            fileStart: number;
          };
          copy.fileStart = offset;
          offset += value.byteLength;
          mp4File.appendBuffer(copy as unknown as MP4BoxBuffer);
        }
      } catch (err) {
        reject(err);
      }
    };

    readChunks();
  });
}

/** Get the codec-specific description box (avcC, hvcC, etc.) */
function getDescription(mp4File: ISOFile, trackId: number): Uint8Array | undefined {
  const trak = mp4File.getTrackById(trackId);
  if (!trak) return undefined;

  // Navigate to sample description entry — mp4box trakBox internals aren't fully typed
  // eslint-disable-next-line
  const stbl = (trak as any).mdia?.minf?.stbl;
  if (!stbl?.stsd?.entries?.length) return undefined;

  const entry = stbl.stsd.entries[0];

  // Video: avcC or hvcC
  const descBox = entry.avcC || entry.hvcC || entry.vpcC;
  if (descBox) {
    const stream = new DataStream(undefined, 0, Endianness.BIG_ENDIAN);
    descBox.write(stream);
    const buf = stream.buffer as ArrayBuffer;
    // Copy bytes starting at offset 8 to skip the box header (4-byte size + 4-byte type).
    // IMPORTANT: Must use slice() to create a standalone ArrayBuffer copy, NOT a Uint8Array
    // view with offset — some WebCodecs implementations may read from byte 0 of the
    // underlying buffer, ignoring the view's byteOffset.
    const desc = new Uint8Array(buf.slice(8));

    // Validate: avcC configurationVersion should be 1
    if (desc.length > 0 && desc[0] !== 1) {
      console.warn(
        `[demuxer] getDescription: unexpected configurationVersion=${desc[0]} ` +
          `(expected 1). Buffer size=${buf.byteLength}, desc size=${desc.length}`
      );
    } else {
      console.log(
        `[demuxer] getDescription: valid avcC, size=${desc.length}, ` +
          `profile=${desc[1]}, compat=${desc[2]}, level=${desc[3]}, ` +
          `first bytes=${Array.from(desc.slice(0, 8))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(' ')}`
      );
    }

    return desc;
  }

  // Note: Audio descriptions (esds) are NOT extracted here because we use
  // OfflineAudioContext for audio decoding, not WebCodecs AudioDecoder.
  // The esds box lacks a custom write() method in mp4box.js, so serialization
  // would not produce valid data anyway.

  return undefined;
}
