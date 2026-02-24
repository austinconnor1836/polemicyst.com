# AGENTS.md

## Cursor Cloud specific instructions

### Architecture
Clips Genie (Polemicyst) is a multi-service monorepo for social media video clip generation and distribution:
- **Frontend**: Next.js 15 (port 3000) — main web app with SSR, API routes, NextAuth
- **Backend**: Express 5 (port 3001) — REST API for transcription, clip generation, metadata
- **Clip Worker**: BullMQ worker for clip-generation and metadata-generation queues
- **PostgreSQL 15**: Primary database (port 5432, via Docker)
- **Redis**: BullMQ job queue (port 6379, via Docker)

### Starting infrastructure services
```bash
sudo dockerd &>/tmp/dockerd.log &
sleep 3
sudo docker compose up -d db redis
```

### Running the frontend (Next.js dev server)
```bash
npm run dev
```
This runs `next dev --experimental-https` with auto-generated self-signed certificates (mkcert is auto-downloaded on first run). Chrome will show a cert warning — click Advanced > Proceed to bypass.

### Running the backend (Express)
```bash
npm run backend        # run without rebuilding (uses existing JS)
npm run backend:build  # build TypeScript first, then run
```
Both scripts are defined in the root `package.json`. The backend compiles TypeScript in-place (no `dist/` directory). The `shared/lib/prisma.ts` module is referenced via relative paths.

### Environment variables
A `.env` file at the project root is required. Key variables:
- `DATABASE_URL` — must use `localhost` for local dev (not `db` which is the Docker Compose service name)
- `REDIS_HOST=localhost`
- `NEXTAUTH_SECRET`, `NEXTAUTH_URL`
- OAuth credentials (Google, Facebook, Twitter) are needed for sign-in but not for basic dev

### Database setup
```bash
npx prisma generate
npx prisma db push
```

### Gotchas
- The `next.config.js` has `rewrites` pointing backend proxy to `host.docker.internal:3001`, which only works inside Docker. For local dev, the frontend API route at `/api/test-backend` calls the backend directly at `http://localhost:3001`.
- There are pre-existing TypeScript errors in the root project (in `src/app/api/gd/`, `src/app/api/webhooks/stripe/`, `src/app/multiple-file-upload/`, `src/app/posts/`). These do not block the Next.js dev server.
- No ESLint configuration exists in the repo. Running `npx next lint` prompts for setup.
- The backend has no automated test suite (`npm test` just echoes an error message).
- The clip-worker builds cleanly with `npx tsc` from its directory.
