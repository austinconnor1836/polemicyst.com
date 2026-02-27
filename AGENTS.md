# AGENTS.md

## Cursor Cloud specific instructions

### Product overview

Clips Genie (branded "POLEMICYST") is a social media video clip generation and distribution platform. It uses Next.js 15 for the frontend (port 3000), an Express 5 backend API (port 3001), BullMQ workers for async clip processing, Prisma ORM with PostgreSQL, and Redis for job queuing.

### Architecture

- **Root** (`/workspace`): Next.js 15 frontend + API routes
- **`backend/`**: Express 5 API server (TypeScript, compiled with `tsc`)
- **`clip-worker/`**: BullMQ worker for clip-generation queue
- **`shared/`**: Shared Prisma client used by multiple packages
- **`prisma/`**: Prisma schema and migrations
- **`workers/`**: Poller worker for automated video feed polling

### Required services

| Service | How to start | Port |
|---|---|---|
| PostgreSQL | `sudo pg_ctlcluster 16 main start` | 5432 |
| Redis | `sudo redis-server --daemonize yes` | 6379 |
| Next.js frontend | `npx next dev --port 3000` (from root) | 3000 |
| Express backend | `cd backend && npx tsc && node index.js` | 3001 |

### Key caveats

- The shell may have a pre-existing `DATABASE_URL` env var pointing to `db:5432` (Docker hostname). Always override `DATABASE_URL` to point to `localhost:5432` with the `clips-genie` database, user `postgres`, password `postgres` before running Prisma commands or the backend.
- `next.config.js` rewrites `/api/backend/*` to `http://host.docker.internal:3001/*`. This works in Docker but not for native local dev. For local dev, the frontend and backend work independently on their respective ports.
- `npm run build` (production build) fails due to missing `@/` path alias in `tsconfig.json` — this is a pre-existing repo issue. The dev server (`next dev`) handles it fine.
- No ESLint configuration exists in the repo. No automated test suite is configured (`backend/package.json` test script is a no-op).
- The `.env` file must exist at the repo root with at minimum: `DATABASE_URL`, `REDIS_HOST`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Placeholder values work for OAuth providers and AWS credentials for basic dev.
- All three packages (root, `backend/`, `clip-worker/`) use npm as their package manager (matching `package-lock.json` lockfiles).
- The backend must be compiled with `tsc` before running (`cd backend && npx tsc`). Output JS files are emitted alongside source `.ts` files.
