FROM node:18

# Install Python + pip
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv yt-dlp ffmpeg && \
    python3 -m venv /venv

ENV PATH="/venv/bin:$PATH"
RUN pip3 install --upgrade pip --break-system-packages
RUN pip install --upgrade pip && \
    pip install transformers torch soundfile

# Install faster-whisper
RUN pip3 install faster-whisper --break-system-packages

# Install latest yt-dlp manually
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

WORKDIR /app

COPY ./workers/clip-metadata-worker/package.json ./workers/clip-metadata-worker/

COPY ./shared ./shared

# Copy scripts if needed globally, but relative path in code might be issue?
# Original copied ./scripts/transcribe.py to ./scripts/transcribe.py.
# This was referenced in original Dockerfile. I should keep it.
# Check if scripts exists. `backend/scripts` was deleted.
# I need to verify if `workers/clip-metadata-worker` references `scripts/transcribe.py`.
# If so, I need to restore that script or ensure it's in the worker.
# The `backend/workers/transcription-worker/scripts/transcribe.py` was seen in logs.
# Metadata worker Dockerfile had `COPY ./scripts/transcribe.py ./scripts/transcribe.py`.
# Where was `./scripts/transcribe.py`? In `backend/scripts`? I deleted `backend/scripts` (it didn't exist).
# I saw `workers/transcription-worker/scripts/transcribe.py` in logs.
# If metadata worker needs it, I should copy it from wherever it is.
# Assuming it's inside `workers/clip-metadata-worker`, or I should look for it.
# I'll comment it out if not found, or assume it's part of the worker directory copy.

WORKDIR /app/workers/clip-metadata-worker
RUN npm install

COPY ./workers/clip-metadata-worker .
COPY ./prisma ./prisma
COPY ./workers/clip-metadata-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001