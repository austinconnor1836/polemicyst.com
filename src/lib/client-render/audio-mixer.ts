/**
 * Audio mixing using WebCodecs AudioDecoder + OfflineAudioContext.
 *
 * Uses demuxed EncodedAudioChunks instead of file.arrayBuffer() to avoid
 * loading entire source files (potentially GBs) into memory.
 */
import {
  type AudioMode,
  type ClientTrackInfo,
  type CutInfo,
  AUDIO_SAMPLE_RATE,
  AUDIO_CHANNELS,
} from './types';

export interface DemuxedAudioSource {
  config: AudioDecoderConfig;
  samples: EncodedAudioChunk[];
}

export interface AudioMixOptions {
  creatorAudio: DemuxedAudioSource | null;
  creatorVolume: number;
  refAudio: (DemuxedAudioSource | null)[];
  tracks: ClientTrackInfo[];
  referenceVolume: number;
  audioMode: AudioMode;
  outputDurationS: number;
  cuts?: CutInfo[];
}

/**
 * Build an AudioSpecificConfig for AAC-LC from sample rate and channel count.
 * Required as the `description` for AudioDecoder when the demuxer can't
 * extract the esds box from mp4box.js.
 */
function buildAACDescription(sampleRate: number, channels: number): Uint8Array {
  const freqTable = [
    96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350,
  ];
  let freqIdx = freqTable.indexOf(sampleRate);
  if (freqIdx === -1) {
    console.warn(
      `[audio-mixer] Non-standard sample rate ${sampleRate}, defaulting to 44100 for AAC description`
    );
    freqIdx = 4; // 44100
  }

  // AudioSpecificConfig: objectType(5 bits) + freqIdx(4 bits) + channels(4 bits) + padding(3 bits)
  // objectType = 2 (AAC-LC)
  const byte0 = (2 << 3) | (freqIdx >> 1);
  const byte1 = ((freqIdx & 1) << 7) | (channels << 3);
  return new Uint8Array([byte0, byte1]);
}

/**
 * Decode EncodedAudioChunks to an AudioBuffer using WebCodecs AudioDecoder.
 * Much more memory-efficient than file.arrayBuffer() + decodeAudioData()
 * since we only process the already-extracted audio samples (~21 MB for 22 min)
 * rather than reading the entire video file (~1.6 GB).
 */
async function decodeAudioSamples(source: DemuxedAudioSource): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    const pcmChannels: Float32Array[][] = [];
    let totalFrames = 0;
    let outputChannels = source.config.numberOfChannels || AUDIO_CHANNELS;
    let outputSampleRate = source.config.sampleRate || AUDIO_SAMPLE_RATE;

    const decoder = new AudioDecoder({
      output: (audioData: AudioData) => {
        outputChannels = audioData.numberOfChannels;
        outputSampleRate = audioData.sampleRate;

        for (let ch = 0; ch < audioData.numberOfChannels; ch++) {
          const buffer = new Float32Array(audioData.numberOfFrames);
          audioData.copyTo(buffer, { planeIndex: ch });
          if (!pcmChannels[ch]) pcmChannels[ch] = [];
          pcmChannels[ch].push(buffer);
        }
        totalFrames += audioData.numberOfFrames;
        audioData.close();
      },
      error: (err) => {
        console.error('[audio-mixer] AudioDecoder error:', err);
        reject(err);
      },
    });

    // Ensure description is set for AAC codecs (esds not extracted by demuxer)
    const config = { ...source.config };
    if (!config.description && config.codec?.startsWith('mp4a')) {
      config.description = buildAACDescription(
        config.sampleRate || AUDIO_SAMPLE_RATE,
        config.numberOfChannels || AUDIO_CHANNELS
      );
      console.log(
        `[audio-mixer] Built AAC description for ${config.codec}: ` +
          `sr=${config.sampleRate}, ch=${config.numberOfChannels}`
      );
    }

    try {
      decoder.configure(config);
    } catch (err) {
      reject(new Error(`Failed to configure AudioDecoder: ${err}`));
      return;
    }

    for (const sample of source.samples) {
      try {
        decoder.decode(sample);
      } catch (err) {
        console.warn('[audio-mixer] Failed to decode audio sample:', err);
      }
    }

    decoder
      .flush()
      .then(() => {
        decoder.close();

        if (totalFrames === 0) {
          const ctx = new OfflineAudioContext(AUDIO_CHANNELS, 1, AUDIO_SAMPLE_RATE);
          resolve(ctx.createBuffer(AUDIO_CHANNELS, 1, AUDIO_SAMPLE_RATE));
          return;
        }

        // Concatenate PCM chunks into a single AudioBuffer
        const ctx = new OfflineAudioContext(outputChannels, totalFrames, outputSampleRate);
        const buffer = ctx.createBuffer(outputChannels, totalFrames, outputSampleRate);

        for (let ch = 0; ch < outputChannels; ch++) {
          const dest = buffer.getChannelData(ch);
          let offset = 0;
          for (const chunk of pcmChannels[ch] || []) {
            dest.set(chunk, offset);
            offset += chunk.length;
          }
        }

        resolve(buffer);
      })
      .catch(reject);
  });
}

/**
 * Mix audio tracks using OfflineAudioContext.
 * Returns an AudioBuffer with the mixed audio.
 */
export async function mixAudio(opts: AudioMixOptions): Promise<AudioBuffer> {
  const totalSamples = Math.ceil(opts.outputDurationS * AUDIO_SAMPLE_RATE);
  if (totalSamples === 0) {
    const ctx = new OfflineAudioContext(AUDIO_CHANNELS, 1, AUDIO_SAMPLE_RATE);
    return ctx.createBuffer(AUDIO_CHANNELS, 1, AUDIO_SAMPLE_RATE);
  }

  console.log(
    `[audio-mixer] Mixing: duration=${opts.outputDurationS.toFixed(1)}s, ` +
      `mode=${opts.audioMode}, totalSamples=${totalSamples}`
  );

  const offlineCtx = new OfflineAudioContext(AUDIO_CHANNELS, totalSamples, AUDIO_SAMPLE_RATE);

  const includeCreator = opts.audioMode === 'creator' || opts.audioMode === 'both';
  const includeRef = opts.audioMode === 'reference' || opts.audioMode === 'both';

  if (includeCreator && opts.creatorAudio && opts.creatorAudio.samples.length > 0) {
    try {
      console.log(
        `[audio-mixer] Decoding creator audio: ${opts.creatorAudio.samples.length} samples`
      );
      const creatorBuffer = await decodeAudioSamples(opts.creatorAudio);
      console.log(
        `[audio-mixer] Creator audio decoded: ${creatorBuffer.duration.toFixed(1)}s, ` +
          `${creatorBuffer.numberOfChannels}ch, ${creatorBuffer.sampleRate}Hz`
      );

      const source = offlineCtx.createBufferSource();
      source.buffer = creatorBuffer;

      const gain = offlineCtx.createGain();
      gain.gain.value = opts.creatorVolume;

      source.connect(gain);
      gain.connect(offlineCtx.destination);
      source.start(0);
    } catch (err) {
      console.warn('[audio-mixer] Failed to decode creator audio, skipping:', err);
    }
  }

  if (includeRef) {
    for (let i = 0; i < opts.tracks.length; i++) {
      const track = opts.tracks[i];
      if (!track.hasAudio) continue;

      const refAudio = opts.refAudio[i];
      if (!refAudio || refAudio.samples.length === 0) continue;

      try {
        console.log(`[audio-mixer] Decoding ref ${i} audio: ${refAudio.samples.length} samples`);
        const refBuffer = await decodeAudioSamples(refAudio);
        console.log(
          `[audio-mixer] Ref ${i} audio decoded: ${refBuffer.duration.toFixed(1)}s, ` +
            `${refBuffer.numberOfChannels}ch`
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = refBuffer;

        const gain = offlineCtx.createGain();
        gain.gain.value = opts.referenceVolume;

        source.connect(gain);
        gain.connect(offlineCtx.destination);
        source.start(track.startAtS);
      } catch (err) {
        console.warn(`[audio-mixer] Failed to decode ref ${i} audio, skipping:`, err);
      }
    }
  }

  console.log('[audio-mixer] Starting OfflineAudioContext render...');
  const result = await offlineCtx.startRendering();
  console.log(`[audio-mixer] Mix complete: ${result.duration.toFixed(1)}s`);
  return result;
}
