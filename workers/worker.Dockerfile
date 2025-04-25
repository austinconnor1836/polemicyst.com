FROM node:18

WORKDIR /app

# Copy package.json and install dependencies
COPY ./workers/package.json ./workers/package-lock.json tsconfig.base.json ./
RUN npm install

COPY shared ./shared
COPY prisma ./prisma
COPY workers ./workers

WORKDIR /app/workers

# Build TypeScript (assuming backend has tsconfig.json pointing to /dist)
RUN npm run build

# Command will be overridden in docker-compose.yml for poller
# CMD ["node", "dist/workers/runPollFeeds.js"]
CMD [ "bash" ]
