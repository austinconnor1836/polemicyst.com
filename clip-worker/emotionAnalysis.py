from transformers import pipeline
import sys
import json

# Load the Wav2Vec model for emotion detection
emotion_model = pipeline("audio-classification", model="superb/wav2vec2-large-xlsr-53-emotion")

def analyze_emotion(audio_path):
    result = emotion_model(audio_path)
    return result

if __name__ == "__main__":
    audio_path = sys.argv[1]
    emotions = analyze_emotion(audio_path)
    print(json.dumps(emotions))
