FROM node:18

# Install yt-dlp and dependencies
RUN apt-get update && apt-get install -y python3 python3-pip curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

WORKDIR /app

COPY ./backend/workers/transcription-worker .
COPY ./shared ./shared
COPY ./prisma/ ./prisma/
COPY tsconfig.docker.json tsconfig.json
RUN chmod +x ./start.sh

RUN npm install

RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001