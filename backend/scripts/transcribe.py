from faster_whisper import WhisperModel
import tempfile
import sys

# Read from stdin and save to a temporary file
with tempfile.NamedTemporaryFile(delete=False, suffix=".mp4") as tmp:
    tmp.write(sys.stdin.buffer.read())
    tmp.flush()
    temp_video_path = tmp.name

# Load the Whisper model
model = WhisperModel("base", compute_type="int8")

# Transcribe from the temp file
segments, _ = model.transcribe(temp_video_path, beam_size=5)

# Output full transcript
transcript = " ".join([s.text for s in segments])
print(transcript)
