"""
Transcribe a video with speaker diarization.

Uses faster_whisper for transcription and pyannote.audio for speaker identification.
Outputs JSON with speaker-labeled transcript segments.

Usage:
  python3 transcribe_with_speakers.py <video_path_or_-> [--num-speakers N] [--hf-token TOKEN]

Output JSON format:
{
  "transcript": "full text...",
  "segments": [
    {"start": 0.0, "end": 2.5, "text": "Hello there", "speaker": "Speaker 1"},
    ...
  ],
  "speakers": ["Speaker 1", "Speaker 2"]
}
"""

import sys
import os
import json
import subprocess
import tempfile
import argparse
from faster_whisper import WhisperModel


def has_audio_stream(path):
    try:
        result = subprocess.run(
            [
                "ffprobe",
                "-v",
                "error",
                "-select_streams",
                "a",
                "-show_entries",
                "stream=index",
                "-of",
                "csv=p=0",
                path,
            ],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return bool(result.stdout.strip())
    except Exception as e:
        print(f"ffprobe error: {e}", file=sys.stderr)
        return False


def extract_audio_wav(video_path, output_path):
    """Extract audio from video as 16kHz mono WAV for diarization."""
    result = subprocess.run(
        [
            "ffmpeg",
            "-y",
            "-i",
            video_path,
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-f",
            "wav",
            output_path,
        ],
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        raise RuntimeError(
            f"FFmpeg audio extraction failed: {result.stderr.decode()}"
        )
    return output_path


def run_diarization(audio_path, num_speakers=None, hf_token=None):
    """
    Run speaker diarization using pyannote.audio.
    Returns a list of (start, end, speaker_label) tuples.
    """
    from pyannote.audio import Pipeline

    token = hf_token or os.environ.get("HF_TOKEN")
    if not token:
        print(
            "Warning: No HF_TOKEN provided. Pyannote requires a Hugging Face token.",
            file=sys.stderr,
        )
        print(
            "Set HF_TOKEN env var or pass --hf-token. Falling back to no diarization.",
            file=sys.stderr,
        )
        return None

    pipeline = Pipeline.from_pretrained(
        "pyannote/speaker-diarization-3.1", use_auth_token=token
    )

    diarization_params = {}
    if num_speakers is not None:
        diarization_params["num_speakers"] = num_speakers

    diarization = pipeline(audio_path, **diarization_params)

    turns = []
    for turn, _, speaker in diarization.itertracks(yield_label=True):
        turns.append((turn.start, turn.end, speaker))

    return turns


def assign_speakers_to_segments(segments, diarization_turns):
    """
    Assign speaker labels to transcript segments based on temporal overlap.
    For each segment, find which speaker has the most overlap.
    """
    if not diarization_turns:
        return segments

    labeled_segments = []
    for seg in segments:
        seg_start = seg["start"]
        seg_end = seg["end"]
        seg_mid = (seg_start + seg_end) / 2.0

        speaker_overlap = {}
        for turn_start, turn_end, speaker in diarization_turns:
            overlap_start = max(seg_start, turn_start)
            overlap_end = min(seg_end, turn_end)
            overlap = max(0, overlap_end - overlap_start)
            if overlap > 0:
                speaker_overlap[speaker] = speaker_overlap.get(speaker, 0) + overlap

        if speaker_overlap:
            best_speaker = max(speaker_overlap, key=speaker_overlap.get)
        else:
            best_speaker = min(
                diarization_turns,
                key=lambda t: abs((t[0] + t[1]) / 2.0 - seg_mid),
            )[2]

        labeled_segments.append({**seg, "speaker": best_speaker})

    return labeled_segments


def normalize_speaker_labels(segments):
    """
    Replace pyannote speaker IDs (e.g. 'SPEAKER_00') with friendlier labels
    ('Speaker 1', 'Speaker 2', etc.), preserving order of first appearance.
    """
    label_map = {}
    counter = 1

    for seg in segments:
        raw = seg.get("speaker", "Unknown")
        if raw not in label_map:
            label_map[raw] = f"Speaker {counter}"
            counter += 1
        seg["speaker"] = label_map[raw]

    speakers = list(label_map.values())
    return segments, speakers


def main():
    parser = argparse.ArgumentParser(
        description="Transcribe video with speaker identification"
    )
    parser.add_argument(
        "video_path", help="Path to the video file (use '-' for stdin)"
    )
    parser.add_argument(
        "--num-speakers",
        type=int,
        default=None,
        help="Expected number of speakers (optional, improves accuracy)",
    )
    parser.add_argument(
        "--hf-token",
        type=str,
        default=None,
        help="Hugging Face token for pyannote.audio",
    )
    args = parser.parse_args()

    video_path = args.video_path

    # Handle stdin piping
    if video_path == "-":
        tmp = tempfile.NamedTemporaryFile(suffix=".mp4", delete=False)
        tmp.write(sys.stdin.buffer.read())
        tmp.close()
        video_path = tmp.name

    if not has_audio_stream(video_path):
        print("ERROR: No audio stream found in video", file=sys.stderr)
        sys.exit(1)

    # Step 1: Transcribe with faster_whisper
    print("Transcribing with faster_whisper...", file=sys.stderr)
    model = WhisperModel("base", compute_type="int8")
    whisper_segments, info = model.transcribe(
        video_path, beam_size=5, word_timestamps=True
    )

    segments = []
    for segment in whisper_segments:
        segments.append(
            {
                "start": segment.start,
                "end": segment.end,
                "text": segment.text.strip(),
            }
        )

    # Step 2: Extract WAV for diarization
    print("Extracting audio for diarization...", file=sys.stderr)
    wav_path = tempfile.mktemp(suffix=".wav")
    try:
        extract_audio_wav(video_path, wav_path)
    except RuntimeError as e:
        print(f"Audio extraction failed: {e}", file=sys.stderr)
        # Fall back to transcript without speakers
        result = {
            "transcript": " ".join([s["text"] for s in segments]),
            "segments": segments,
            "speakers": [],
        }
        print(json.dumps(result))
        sys.exit(0)

    # Step 3: Run speaker diarization
    print("Running speaker diarization...", file=sys.stderr)
    diarization_turns = None
    try:
        diarization_turns = run_diarization(
            wav_path,
            num_speakers=args.num_speakers,
            hf_token=args.hf_token,
        )
    except Exception as e:
        print(
            f"Diarization failed (continuing without speakers): {e}",
            file=sys.stderr,
        )

    # Step 4: Assign speakers to segments
    if diarization_turns:
        print("Assigning speakers to transcript segments...", file=sys.stderr)
        segments = assign_speakers_to_segments(segments, diarization_turns)
        segments, speakers = normalize_speaker_labels(segments)
    else:
        speakers = ["Speaker 1"]
        for seg in segments:
            seg["speaker"] = "Speaker 1"

    # Clean up temp files
    try:
        os.unlink(wav_path)
    except OSError:
        pass
    if args.video_path == "-":
        try:
            os.unlink(video_path)
        except OSError:
            pass

    # Output result
    result = {
        "transcript": " ".join([s["text"] for s in segments]),
        "segments": segments,
        "speakers": speakers,
    }
    print(json.dumps(result))


if __name__ == "__main__":
    main()
