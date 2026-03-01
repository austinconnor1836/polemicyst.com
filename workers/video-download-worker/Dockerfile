FROM node:20

# Install yt-dlp and dependencies
RUN apt-get update && apt-get install -y python3 python3-pip curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY ./workers/video-download-worker/package*.json ./workers/video-download-worker/

COPY ./shared ./shared



WORKDIR /app/workers/video-download-worker
RUN npm install

COPY ./workers/video-download-worker .
COPY ./prisma ./prisma
COPY ./workers/video-download-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001