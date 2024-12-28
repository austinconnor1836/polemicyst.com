# Use an official Node.js runtime as a parent image
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps
RUN apk add --no-cache libc6-compat

# Set the working directory in the container
WORKDIR /app

# Copy package.json and lock file to the container
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Development Stage
FROM base AS development
WORKDIR /app

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

ENV NODE_ENV=development
EXPOSE 3000

# Enable HMR and polling
ENV CHOKIDAR_USEPOLLING=true
ENV WATCHPACK_POLLING=true

# Use hot reload during development
CMD ["npm", "run", "dev"]

# Build Stage
FROM base AS builder
WORKDIR /app
ENV NODE_ENV=production

# Copy dependencies from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Pass environment variables during build
ARG MONGO_URI
ENV MONGO_URI=$MONGO_URI

# Use the local Next.js binary instead of global install
RUN ./node_modules/.bin/next build

# Production image, minimal setup
FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production

# System-level user for security
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

# Copy built app and dependencies
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/node_modules ./node_modules

# Set permissions
RUN chown nextjs:nodejs .next

USER nextjs

EXPOSE 3000

ENV PORT=3000

# Start the Next.js app using local binary
CMD ["npm", "run", "start"]
