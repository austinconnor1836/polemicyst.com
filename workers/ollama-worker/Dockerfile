FROM ollama/ollama

WORKDIR /app
COPY ./workers/ollama-worker/ .

RUN sed -i 's/\r$//' ./scripts/start-ollama.sh && \
    chmod +x ./scripts/start-ollama.sh

RUN apt-get update && \
    apt-get install -y curl && \
    apt-get clean
