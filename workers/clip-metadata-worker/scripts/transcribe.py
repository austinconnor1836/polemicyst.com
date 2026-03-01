import sys
import subprocess
import json
import io
import tempfile
from faster_whisper import WhisperModel

model = WhisperModel("base", compute_type="int8")

# Support stdin ('-') or file path
if len(sys.argv) > 1 and sys.argv[1] == "-":
    # Read from stdin and write to a temp file
    with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
        tmp.write(sys.stdin.buffer.read())
        temp_video_path = tmp.name
else:
    temp_video_path = sys.argv[1]


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


# 🔍 Check audio before transcription
if not has_audio_stream(temp_video_path):
    print("ERROR: No audio stream found in video", file=sys.stderr)
    sys.exit(1)

# 📝 Perform transcription
try:
    segments, info = model.transcribe(
        temp_video_path, beam_size=5, word_timestamps=True
    )
    results = []
    for segment in segments:
        results.append(
            {"start": segment.start, "end": segment.end, "text": segment.text.strip()}
        )

    print(
        json.dumps(
            {"transcript": " ".join([s["text"] for s in results]), "segments": results}
        )
    )
except Exception as e:
    print(f"Transcription error: {e}", file=sys.stderr)
    sys.exit(1)
