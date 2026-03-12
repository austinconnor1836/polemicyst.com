FROM node:20-bullseye-slim AS base

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN NODE_ENV=development npm ci --ignore-scripts --legacy-peer-deps
RUN npx prisma generate

COPY next.config.js postcss.config.js tailwind.config.ts tsconfig.json next-auth.d.ts components.json ./
COPY auth.ts ./auth.ts
COPY public ./public
COPY src ./src
COPY shared ./shared
COPY workers ./workers
COPY _posts ./_posts
RUN npm run build

FROM node:20-bullseye-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends python3 curl && \
    curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp && \
    chmod a+rx /usr/local/bin/yt-dlp && \
    apt-get remove -y curl && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public
COPY --from=base /app/prisma ./prisma
RUN npm install --no-save prisma
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
