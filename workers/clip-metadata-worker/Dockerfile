FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ffmpeg curl ca-certificates && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /venv && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

ENV PATH="/venv/bin:$PATH"
ENV PIP_NO_CACHE_DIR=1

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir faster-whisper

WORKDIR /app

COPY ./workers/clip-metadata-worker/package*.json ./workers/clip-metadata-worker/
COPY ./shared ./shared
RUN rm -f ./shared/lib/auth.ts ./shared/lib/auth-helpers.ts && \
    rm -rf ./shared/lib/publishing ./shared/util/youtube-api.ts

WORKDIR /app/workers/clip-metadata-worker
RUN npm install

COPY ./workers/clip-metadata-worker .
COPY ./prisma ./prisma
COPY ./workers/clip-metadata-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001
