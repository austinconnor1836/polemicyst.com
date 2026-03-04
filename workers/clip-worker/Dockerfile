FROM node:18-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends python3 python3-pip python3-venv ffmpeg && \
    rm -rf /var/lib/apt/lists/* && \
    python3 -m venv /venv

ENV PATH="/venv/bin:$PATH"
ENV PIP_NO_CACHE_DIR=1

RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir faster-whisper

WORKDIR /app

COPY ./workers/clip-worker/package*.json ./workers/clip-worker/
COPY ./shared ./shared
RUN rm -f ./shared/lib/auth.ts ./shared/lib/auth-helpers.ts

WORKDIR /app/workers/clip-worker
RUN npm install

COPY ./workers/clip-worker .
COPY ./prisma ./prisma
COPY ./workers/clip-worker/tsconfig.docker.json tsconfig.json

RUN chmod +x ./start.sh
RUN npx prisma generate --schema=./prisma/schema.prisma
RUN npm run build

EXPOSE 3001
CMD ["node", "index.js"]
