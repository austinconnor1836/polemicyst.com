FROM node:18

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-pip yt-dlp

# Install latest yt-dlp manually (better than relying on Debian apt package)
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

# Copy package.json and install dependencies
COPY ./workers .
COPY ./prisma ./prisma
COPY package*.json ./
RUN npm install

RUN npx prisma generate --schema=prisma/schema.prisma

# Build TypeScript (assuming backend has tsconfig.json pointing to /dist)
RUN npm run build:worker

# Copy the start.sh script into the container
COPY ./workers/start.sh ./start.sh
RUN chmod +x ./start.sh

# Set startup command to use start.sh
CMD ["./start.sh"]
