FROM node:18

WORKDIR /app

# Update and install dependencies
RUN apt-get update && apt-get install -y python3 python3-pip yt-dlp

# Install latest yt-dlp manually
RUN curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && yt-dlp --version  # Print version to verify install

# Copy worker scripts and package files
COPY ./workers . 
COPY ./prisma ./prisma
COPY package*.json ./

# Install Node.js dependencies
RUN npm install

# Generate Prisma client
RUN npx prisma generate --schema=prisma/schema.prisma

# Build TypeScript workers (assumes tsconfig.json is configured)
RUN npm run build:worker

# Copy the start script
COPY ./workers/start.sh ./start.sh
RUN chmod +x ./start.sh

# Set the default command to run the start script
CMD ["./start.sh"]
