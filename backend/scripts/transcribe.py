from faster_whisper import WhisperModel
import tempfile
import sys
import json

# Read from stdin and save to a temporary file
with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
    tmp.write(sys.stdin.buffer.read())
    tmp.flush()
    temp_video_path = tmp.name

# Load the Whisper model (use base or medium as needed)
model = WhisperModel("base", compute_type="int8")

# Transcribe with word-level timestamps
segments, _ = model.transcribe(temp_video_path, beam_size=5, word_timestamps=True)

# Format output as JSON with text + timestamps
results = []
for segment in segments:
    results.append({
        "start": segment.start,
        "end": segment.end,
        "text": segment.text,
        "words": [
            {
                "word": w.word,
                "start": w.start,
                "end": w.end
            } for w in segment.words
        ]
    })

# Combine text for full transcript
full_transcript = " ".join([s["text"] for s in results])

# Output JSON object with transcript and segments
print(json.dumps({
    "transcript": full_transcript,
    "segments": results
}))
