FROM node:18

WORKDIR /app

RUN apt-get update && apt-get install -y python3 python3-pip yt-dlp

# Copy package.json and install dependencies
# COPY ./workers/package.json ./workers/package-lock.json tsconfig.base.json ./workers/tsconfig.json ./
COPY ./workers .
COPY ./prisma ./prisma
RUN npm install

RUN npx prisma generate --schema=prisma/schema.prisma

# Build TypeScript (assuming backend has tsconfig.json pointing to /dist)
RUN npm run build

# Command will be overridden in docker-compose.yml for poller
CMD ["node", "runPollFeeds.js"]
# CMD [ "bash" ]
