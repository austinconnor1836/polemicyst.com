FROM node:18-slim

# System deps for Python + venv + FFmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /venv

# Activate virtualenv and install Python packages
ENV PATH="/venv/bin:$PATH"
ENV PIP_NO_CACHE_DIR=1
RUN pip3 install --upgrade pip --break-system-packages && \
    pip install --upgrade pip && \
    pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu && \
    pip install --no-cache-dir faster-whisper transformers soundfile

WORKDIR /app

# Copy deps
COPY ./workers/clip-worker/package*.json ./workers/clip-worker/

# Copy shared & prisma
COPY ./shared ./shared

WORKDIR /app/workers/clip-worker
RUN npm install

# Copy application code
COPY ./workers/clip-worker .
COPY ./prisma ./prisma

COPY ./workers/clip-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh

# Generate Prisma client
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript
RUN npm run build

EXPOSE 3001
CMD ["node", "index.js"]
