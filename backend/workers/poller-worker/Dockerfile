FROM node:18

# Update and install dependencies
RUN apt-get update && apt-get install -y python3 python3-pip yt-dlp ffmpeg
ENV PATH="/venv/bin:$PATH"

# Install latest yt-dlp manually
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

WORKDIR /app
# Copy worker scripts and package files
COPY ./backend/workers/poller-worker . 
COPY ./shared/ ./shared/
COPY ./prisma ./prisma/
COPY tsconfig.docker.json tsconfig.json
# COPY package*.json ./

RUN chmod +x ./start.sh
# Install Node.js dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Build TypeScript workers (assumes tsconfig.json is configured)
RUN npm run build