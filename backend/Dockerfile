FROM node:18

# Install Python + pip
RUN apt-get update && \
    apt-get install -y python3 python3-pip yt-dlp ffmpeg && \
    pip3 install --upgrade pip --break-system-packages

# Install faster-whisper
RUN pip3 install faster-whisper --break-system-packages

# Install latest yt-dlp manually
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

# Set workdir and copy backend files
# WORKDIR /app

# Copy backend package files and install deps
# COPY ./backend/package*.json ./backend/
# WORKDIR /app/backend


# Copy full context after installing deps
WORKDIR /app
# COPY . .
COPY ./backend .
COPY ./shared/ ./shared/
COPY ./prisma/ ./prisma/
COPY tsconfig.docker.json tsconfig.json

RUN chmod +x ./workers/start.sh


# Update tsconfig.json path alias for Docker image
# RUN sed -i 's|"@shared/\\*": \["../shared/\\*"\]|"@shared/*": ["/app/shared/*"]|g' /app/tsconfig.json

RUN npm install

# Generate Prisma client (output goes to backend/node_modules/.prisma)
# WORKDIR /app/backend
RUN npx prisma generate --schema=./prisma/schema.prisma

# Build backend TypeScript
RUN npm run build

EXPOSE 3001
# Print directory and file structure before starting