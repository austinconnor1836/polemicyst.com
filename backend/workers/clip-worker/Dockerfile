FROM node:18

# System deps for Python + venv
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    python3 -m venv /venv

# Activate virtualenv and install Python packages
ENV PATH="/venv/bin:$PATH"
RUN pip3 install --upgrade pip --break-system-packages
RUN pip install --upgrade pip && \
    pip install transformers torch soundfile

# Node setup
WORKDIR /app

COPY ./backend/workers/clip-worker/package*.json ./

RUN npm install

COPY ./backend/workers/clip-worker .
COPY ./shared ./shared
COPY ./prisma/ ./prisma/
COPY tsconfig.docker.json tsconfig.json
RUN chmod +x ./start.sh

# Generate Prisma client
# WORKDIR /app/clip-worker
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build TypeScript
RUN npm run build

EXPOSE 3001