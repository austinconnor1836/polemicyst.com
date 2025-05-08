FROM python:3.9-slim

WORKDIR /app

# Install FFmpeg
RUN apt-get update && \
    apt-get install -y ffmpeg && \
    apt-get clean

# Install necessary Python packages
RUN pip install --no-cache-dir flask transformers torch

# Copy the AI service file
COPY aiService.py .

# Expose the port for the Flask app
EXPOSE 5000

# Run the Flask application
CMD ["python", "aiService.py"]
