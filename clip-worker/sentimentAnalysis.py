from transformers import pipeline
import sys
import json

# Load the sentiment analysis model
sentiment_model = pipeline("sentiment-analysis", model="cardiffnlp/twitter-roberta-base-sentiment")

def analyze_sentiment(text):
    result = sentiment_model(text)
    return result

if __name__ == "__main__":
    text = sys.argv[1]
    sentiment = analyze_sentiment(text)
    print(json.dumps(sentiment))
