FROM ollama/ollama

WORKDIR /app
COPY ./backend/workers/ollama-worker/ .

RUN apt-get update && \
    apt-get install -y curl && \
    apt-get clean
