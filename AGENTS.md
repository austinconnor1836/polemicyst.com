# Polemicyst web/app package - agent entrypoint

This file is the repo-level guide for `polemicyst.com/`.

This package contains the **Next.js app** plus **workers** used in local dev via Docker Compose.

## Common commands (run from `polemicyst.com/`)

- Web UI dev: `npm run dev` (Next uses `--experimental-https`)
- Web build: `npm run build`
- Full stack (db/redis/workers hot reload):  
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`

## Cursor Cloud specific instructions

### Authenticating in the web app (manual testing)

The app uses Google OAuth, which cloud agents can't complete. A dev-only login endpoint bypasses this:

1. Ensure these env vars are set (add as Cursor Cloud Agent secrets if not):
   - `DEV_USER_EMAIL` — the email of the user account to log in as
   - `DEV_LOGIN_SECRET` — a random secret token (e.g. `openssl rand -hex 32`)
   - `NEXTAUTH_SECRET` — the NextAuth JWT secret (any random string works for local dev)
   - `DATABASE_URL` — Postgres connection string (required for Prisma)
2. Start the dev server: `npx next dev --port 3000`
3. In the `computerUse` subagent, navigate to `http://localhost:3000/api/auth/dev-login?token=$DEV_LOGIN_SECRET`
4. The browser will be redirected to `/` with a valid session cookie. All authenticated pages now work.

Security: The endpoint requires three conditions to function — `NODE_ENV !== 'production'`, both `DEV_USER_EMAIL` and `DEV_LOGIN_SECRET` env vars set, and the correct secret passed as a `?token=` query parameter. Without the secret, the endpoint returns 404. It creates the user in the DB if they don't exist.

### GitHub authentication (PRs, CI triggers)

Add a GitHub PAT as the `GH_TOKEN` Cursor Cloud Agent secret. The startup script should run:

```bash
if [ -n "$GH_TOKEN" ]; then
  echo "$GH_TOKEN" | gh auth login --with-token
  git config --global url."https://x-access-token:${GH_TOKEN}@github.com/".insteadOf "https://github.com/"
fi
```

Without this, the agent can push code but cannot create PRs, close/reopen PRs, or trigger CI workflows.

## Key files

- Next App Router: `src/app/*`
- Next API routes: `src/app/api/*`
- Prisma schema: `prisma/schema.prisma` (client: `shared/lib/prisma.ts`)
- Clip workers: `clip-worker/`
- Poller worker: `workers/`

## Production deployment (AWS + Terraform)

Quick path (single region, HA):

- Infrastructure lives in `infrastructure/` (VPC + private subnets + NAT + ALB + ECS + RDS + Route53 + ACM).
- Web container build lives at repo root `Dockerfile` (Next.js `output: 'standalone'`).
- CI/CD is in `.github/workflows/deploy.yml` (builds/pushes web + workers, then triggers ECS deployments).
- DNS is managed by Route53. After `terraform apply`, copy the Route53 nameservers and update them in Namecheap.
- Use Multi-AZ RDS for HA within one region. Multi-region is not enabled by default.

Docs: see `docs/DEPLOYMENT.md` for step-by-step setup and required env vars.

If you're returning after a while, start with `docs/DEPLOYMENT.md` and the "Returning checklist" section.

## Environment and S3 notes

- Set `S3_BUCKET` and `S3_REGION` for each environment (dev/prod). Code now uses env values to avoid hardcoded regions.
- If you change buckets between environments, existing DB rows with old `s3Url` values will still point at the old bucket.
  - Either migrate/update those rows or start with a fresh DB for prod.

## Cross-platform API contract

- **Single source of truth:** `openapi/spec.yaml` defines every API endpoint. Web and mobile clients consume from this spec.
- **Rule:** Any new or changed web API endpoint MUST update `openapi/spec.yaml` before merging.
- **Platform-specific instructions:**
  - Android: `android/CLAUDE.md`
  - iOS (future): `ios/CLAUDE.md`
- When adding an API route in `src/app/api/`, also verify the corresponding Retrofit interface in `android/app/src/main/java/.../data/repository/` stays in sync.

## Design tokens (shared palette)

All three clients (Web, Android, iOS) share a single color palette defined in `tokens/colors.json`.

- **Source of truth:** `tokens/colors.json` — 9 tokens (`primary`, `accent`, `background`, `surface`, `text`, `textMuted`, `border`, `success`, `destructive`), each with `light` and `dark` values.
- **Generator:** `npm run tokens` (runs `scripts/generate-tokens.mjs`) and writes:
  - **Web:** `src/app/ui/tokens.css` — CSS custom properties (RGB channels for Tailwind alpha support)
  - **Android:** `android/.../ui/theme/Tokens.kt` — Compose `Color` constants
  - **iOS:** `ios/Polemicyst/Theme/Tokens.swift` — SwiftUI `Color` extensions
- **Tailwind usage:** Token colors are available as `bg-background`, `text-foreground`, `border-border`, `bg-surface`, `bg-primary`, `text-muted`, `bg-accent`, `bg-success`, `bg-destructive`, etc. They auto-switch between light and dark mode — no `dark:` prefix needed.
- **Rule:** When changing a color, edit `tokens/colors.json` and run `npm run tokens`. Never edit the generated files directly.

## UI conventions (quick reminders)

- **Dialogs/modals**: follow the standard spacing pattern in the repo root `../CLAUDE.md`:
  - `DialogHeader` → body wrapper (`space-y-4` or `space-y-3`) → `DialogFooter` with `pt-4`
  - avoid one-off `mb-*` spacing between header badges and media previews
- **Section Headers**:
  - "Add" actions in card/section headers should use `variant="secondary"` to maintain visual hierarchy (primary actions are usually for saving/confirming in modals).

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

### Environment constraints

- **Docker is NOT available** — the VM kernel lacks iptables NAT support. All services (PostgreSQL, Redis) run natively.
- The VM may inject a `DATABASE_URL` env var pointing to `db:5432` (Docker hostname). This is **wrong**. Always export the correct value pointing to `localhost:5432` before running any Prisma or backend commands.

### Required services

| Service | How to start | Port |
|---|---|---|
| PostgreSQL 16 | `sudo service postgresql start` | 5432 |
| Redis | `sudo service redis-server start` (if it fails because port is occupied, first run `redis-cli shutdown` then retry) | 6379 |
| Next.js frontend | `npx next dev --port 3000` (from repo root) | 3000 |
| Express backend | `cd backend && npx tsc && node index.js` | 3001 |

### Database setup (one-time, already done in snapshot)

```
sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"
sudo -u postgres createdb clips-genie   # ignore "already exists" error
```

### Key caveats

- `next.config.js` rewrites `/api/backend/*` to `http://host.docker.internal:3001/*`. This does not resolve in native local dev. The frontend and backend work independently on their own ports; the rewrite only matters when running under Docker.
- `npm run build` (production build) fails due to missing `@/` path alias in `tsconfig.json` — this is a pre-existing repo issue. The dev server (`next dev`) handles it fine.
- No ESLint configuration exists in the repo. No automated test suite is configured (`backend/package.json` test script is a no-op).
- The `.env` file must exist at the repo root with at minimum: `DATABASE_URL`, `REDIS_HOST`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`. Placeholder values work for OAuth providers and AWS credentials for basic dev.
- All three packages (root, `backend/`, `clip-worker/`) use npm as their package manager (matching `package-lock.json` lockfiles).
- The backend must be compiled with `tsc` before running (`cd backend && npx tsc`). Output JS files are emitted alongside source `.ts` files.
- `faster-whisper` is installed via pip3 for the transcription pipeline.
- `@next/swc-linux-x64-gnu` must be installed for Next.js SWC compilation on this platform.
