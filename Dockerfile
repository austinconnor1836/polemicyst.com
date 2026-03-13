FROM node:20-bookworm-slim AS base

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json* ./
COPY prisma ./prisma

RUN apt-get update && apt-get install -y --no-install-recommends openssl && rm -rf /var/lib/apt/lists/*
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

FROM node:20-bookworm-slim AS runner

RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-pip python3-dev gcc git && \
    pip3 install --break-system-packages yt-dlp curl_cffi bgutil-ytdlp-pot-provider && \
    git clone --single-branch --depth 1 https://github.com/Brainicism/bgutil-ytdlp-pot-provider.git /root/bgutil-ytdlp-pot-provider && \
    cd /root/bgutil-ytdlp-pot-provider/server && npm ci && npx tsc && \
    apt-get remove -y python3-pip python3-dev gcc git && apt-get autoremove -y && rm -rf /var/lib/apt/lists/*

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
