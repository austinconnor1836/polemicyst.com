FROM node:20-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
      python3 python3-pip python3-venv ffmpeg curl ca-certificates \
      libass9 fontconfig \
      fonts-dejavu-core fonts-dejavu-extra fonts-liberation fonts-noto-core fonts-noto-mono \
      chromium chromium-sandbox fonts-noto-color-emoji && \
    fc-cache -f && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /venv && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

ENV PATH="/venv/bin:$PATH"
ENV PIP_NO_CACHE_DIR=1

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir faster-whisper rembg Pillow onnxruntime opencv-python-headless

# Pre-download u2net model to avoid cold-start latency
RUN python3 -c "from rembg import new_session; new_session('u2net')"

WORKDIR /app

COPY ./workers/clip-metadata-worker/package*.json ./workers/clip-metadata-worker/
COPY ./shared ./shared
RUN rm -f ./shared/lib/auth.ts ./shared/lib/auth-helpers.ts ./shared/util/youtube-api.ts && \
    find ./shared/lib/publishing -mindepth 1 ! -name 'rasterize.ts' -exec rm -rf {} + || true

WORKDIR /app/workers/clip-metadata-worker
RUN npm install

# Make worker's node_modules resolvable from /app/shared/* imports via symlink.
# Node resolution walks up from shared/lib/publishing/ looking for node_modules,
# and /app/node_modules is the first parent that matches.
RUN mkdir -p /app/node_modules && \
    ln -sfn /app/workers/clip-metadata-worker/node_modules/puppeteer-core /app/node_modules/puppeteer-core

COPY ./workers/clip-metadata-worker .
COPY ./scripts/remove_background.py /app/scripts/remove_background.py
COPY ./scripts/detect_faces.py /app/scripts/detect_faces.py
COPY ./prisma ./prisma
COPY ./workers/clip-metadata-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001

CMD ["./start.sh"]
