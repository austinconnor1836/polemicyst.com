from faster_whisper import WhisperModel
import sys

if len(sys.argv) < 2:
    print("Usage: python transcribe.py <video_path>")
    sys.exit(1)

video_path = sys.argv[1]

# Load the Whisper model
model = WhisperModel("base", compute_type="int8")

# Run transcription
segments, info = model.transcribe(video_path, beam_size=5)

# Collect the full transcript
transcript = " ".join([segment.text for segment in segments])

print(transcript)