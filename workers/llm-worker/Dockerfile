FROM node:20-alpine

WORKDIR /app

# Copy package files
COPY ./workers/llm-worker/package*.json ./workers/llm-worker/

# Change to worker directory
WORKDIR /app/workers/llm-worker
RUN npm install

# Copy application code
COPY ./workers/llm-worker .

# Build TypeScript
RUN npm run build

CMD ["node", "dist/index.js"]
