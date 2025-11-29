FROM node:20-alpine AS builder

WORKDIR /app

COPY backend/workers/llm-worker/package.json backend/workers/llm-worker/package-lock.json* ./
RUN npm install --legacy-peer-deps

COPY backend/workers/llm-worker/ .
RUN npm run build

FROM node:20-alpine

WORKDIR /app

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/node_modules ./node_modules

CMD ["node", "dist/index.js"]
