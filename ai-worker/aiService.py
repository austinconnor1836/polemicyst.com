from flask import Flask, request, jsonify
from transformers import pipeline
import os

app = Flask(__name__)

# Load models dynamically at startup
print("Loading emotion model for audio analysis...")
emotion_model = pipeline("audio-classification", model="ehcalabres/wav2vec2-lg-xlsr-en-speech-emotion-recognition")
print("Emotion model loaded successfully.")

print("Loading sentiment model...")
sentiment_model = pipeline("sentiment-analysis", model="cardiffnlp/twitter-roberta-base-sentiment")
print("Sentiment model loaded successfully.")

@app.route('/emotion-analysis', methods=['POST'])
def emotion_analysis():
    try:
        # Get the uploaded audio file
        file = request.files['file']
        file_path = os.path.join('/tmp', file.filename)
        file.save(file_path)

        # Perform emotion analysis
        result = emotion_model(file_path)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/sentiment-analysis', methods=['POST'])
def sentiment_analysis():
    try:
        # Get the uploaded text file
        file = request.files['file']
        file_path = os.path.join('/tmp', file.filename)
        file.save(file_path)

        # Read the text from the file
        with open(file_path, 'r') as f:
            text = f.read()

        # Perform sentiment analysis
        result = sentiment_model(text)
        return jsonify(result), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000)
