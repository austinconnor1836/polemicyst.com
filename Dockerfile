# Use an official Node.js runtime as a parent image
FROM node:18-alpine AS base

# Install dependencies only when needed
FROM base AS deps

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat

# Set the working directory in the container
WORKDIR /app

COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci

# Rebuild the source code only when needed
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

RUN npm run build;

# Production image, copy all the files and run next
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public

# Set the correct permission for prerender cache
RUN mkdir .next
RUN chown nextjs:nodejs .next

# Automatically leverage output traces to reduce image size
# https://nextjs.org/docs/advanced-features/output-file-tracing
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000

ENV PORT=3000

# server.js is created by next build from the standalone output
# https://nextjs.org/docs/pages/api-reference/next-config-js/output
# CMD HOSTNAME="0.0.0.0" node server.js

# ENV \
# #  MY_INPUT_ENV_VAR=dockerfile-default-env-var \
#  NODE_ENV=production \
#  PORT=3000


# # EXPOSE ${PORT}

# # Copy package.json and package-lock.json
# COPY . .

# # Install dependencies
# RUN npm ci

# # Build the application
# RUN npm run build

# # Use a smaller base image for the final stage
# FROM node:18-alpine

# # Set the working directory in the container
# WORKDIR /app

# # Copy only the necessary files from the builder stage
# # COPY --from=builder /app/package*.json ./
# # COPY --from=builder /app/node_modules ./node_modules
# # COPY --from=builder /app/.next ./.next
# # COPY --from=builder /app/public ./public
# # COPY --from=builder /app/src ./src
# # COPY --from=builder /app/next.config.js ./next.config.js
# COPY --from=builder /app .

# # Expose the port the app runs on
# EXPOSE ${PORT}

# Start the Next.js application
CMD ["npm", "start"]