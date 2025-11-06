FROM node:18-slim

# System deps for Python + venv
RUN apt-get update && \
    apt-get install -y python3 python3-pip python3-venv && \
    python3 -m venv /venv

# Activate virtualenv and install Python packages
ENV PATH="/venv/bin:$PATH"
RUN pip install --upgrade pip && \
    pip install transformers torch soundfile

# Node setup
WORKDIR /app
COPY ./clip-worker/package*.json ./clip-worker/
COPY ./shared ./shared
WORKDIR /app/clip-worker
RUN npm install

WORKDIR /app
COPY . .

# Generate Prisma client
WORKDIR /app/clip-worker
RUN npx prisma generate --schema=../prisma/schema.prisma

# Build TypeScript
RUN npm run build