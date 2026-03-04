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

WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1

COPY --from=base /app/.next/standalone ./
COPY --from=base /app/.next/static ./.next/static
COPY --from=base /app/public ./public
COPY --from=base /app/prisma ./prisma
COPY --from=base /app/node_modules/prisma ./node_modules/prisma
COPY --from=base /app/node_modules/@prisma/engines ./node_modules/@prisma/engines
RUN mkdir -p node_modules/.bin && ln -s ../prisma/build/index.js node_modules/.bin/prisma && chmod +x node_modules/prisma/build/index.js
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

EXPOSE 3000
CMD ["./docker-entrypoint.sh"]
