FROM node:20

# Update and install dependencies
RUN apt-get update && apt-get install -y python3 python3-pip yt-dlp ffmpeg
ENV PATH="/venv/bin:$PATH"

# Install latest yt-dlp manually
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

WORKDIR /app

COPY ./workers/poller-worker/package.json ./workers/poller-worker/
COPY ./shared ./shared
RUN rm -f ./shared/lib/auth.ts ./shared/lib/auth-helpers.ts && \
    rm -rf ./shared/lib/publishing && \
    rm -f ./shared/util/youtube-api.ts


WORKDIR /app/workers/poller-worker
# COPY ./workers/poller-worker/tsconfig.docker.json tsconfig.json
# Assuming it exists or use default
# Original had: COPY tsconfig.docker.json tsconfig.json

RUN npm install
COPY ./workers/poller-worker .
COPY ./prisma ./prisma
# Ensure tsconfig is copied if needed
COPY ./workers/poller-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma

RUN npm run build