# Polemicyst web/app package - agent entrypoint

This file is the repo-level guide for `polemicyst.com/`.

This package contains the **Next.js app** plus **workers** used in local dev via Docker Compose.

## Common commands (run from `polemicyst.com/`)

- Web UI dev: `npm run dev` (Next uses `--experimental-https`)
- Web build: `npm run build`
- Full stack (db/redis/workers hot reload):  
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`

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

## Cursor Cloud specific instructions

Cloud agents run in an isolated VM. Docker is **not available** (the VM kernel lacks iptables NAT support). You MUST start all services natively.

### Environment setup (run at session start)

Steps (run in order):

1. **Fix `DATABASE_URL`:** The VM may inject a value pointing to `db:5432` (Docker DNS). Export the correct value from `.env` which points to `localhost:5432`. Read the value from `.env` and `export` it.
2. **Start PostgreSQL and Redis:** `sudo service postgresql start && sudo service redis-server start`
3. **Set postgres password:** `sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';" 2>/dev/null`
4. **Run Prisma migrations:** `npx prisma migrate deploy`
5. **Install faster-whisper if missing:** `pip3 show faster-whisper >/dev/null 2>&1 || pip3 install faster-whisper`
6. **Start Next.js dev server:** `rm -rf .next && npm run dev > /tmp/nextdev.log 2>&1 &`
7. **Start all 4 workers** (each with `DATABASE_URL` and `REDIS_HOST=localhost` set):
   - `npx tsx watch workers/transcription-worker/index.ts > /tmp/transcription-worker.log 2>&1 &`
   - `npx tsx watch workers/clip-metadata-worker/index.ts > /tmp/clip-metadata-worker.log 2>&1 &`
   - `npx tsx watch workers/video-download-worker/index.ts > /tmp/download-worker.log 2>&1 &`
   - `npx tsx watch workers/poller-worker/index.ts > /tmp/poller-worker.log 2>&1 &`
8. **Wait ~15s, then verify** the server responds with HTTPS 200 on port 3000.

### What's running and why

| Service | How it runs | Notes |
|---------|------------|-------|
| PostgreSQL | `sudo service postgresql start` | Pre-installed in VM |
| Redis | `sudo service redis-server start` | Pre-installed in VM |
| Next.js web app | `npm run dev` | HTTPS via `--experimental-https` (required for Google OAuth) |
| Transcription worker | `tsx watch workers/transcription-worker/index.ts` | Needs `faster-whisper` Python package |
| Clip-metadata worker | `tsx watch workers/clip-metadata-worker/index.ts` | Needs `ffmpeg` (pre-installed) |
| Download worker | `tsx watch workers/video-download-worker/index.ts` | Downloads videos from S3/YouTube |
| Poller worker | `tsx watch workers/poller-worker/index.ts` | Polls feeds for new videos |

### Common pitfalls

- **`DATABASE_URL` override:** The VM injects a `DATABASE_URL` pointing to Docker DNS (`db:5432`) as a shell env var, which overrides `.env`. You MUST `export` the correct localhost value (from `.env`) before starting anything or Prisma will fail with "Can't reach database server at db:5432".
- **Stale `.next` cache:** Can cause CSS/Tailwind to not render (CSS file returns 404). Always `rm -rf .next` before starting the dev server.
- **Missing SWC binary:** If the dev server warns about missing SWC dependencies, run `npm install @next/swc-linux-x64-gnu`.
- **HTTP vs HTTPS:** `npm run dev` serves HTTPS with a self-signed cert. Always use `https://` in the browser. The browser will show a cert warning — click "Advanced" then "Proceed" to accept it.
- **Docker does not work** in cloud agent VMs — the kernel does not support iptables NAT. Do not attempt `docker compose up`.
- **Worker logs** are at `/tmp/transcription-worker.log`, `/tmp/clip-metadata-worker.log`, `/tmp/download-worker.log`, `/tmp/poller-worker.log`.

### Testing UI changes

After starting all services, use the `computerUse` subagent to open the app in Chrome via HTTPS on port 3000. Accept the self-signed certificate warning. Verify the page renders with proper Tailwind CSS styling (not unstyled bullet points / plain text).

## UI conventions (quick reminders)

- **Dialogs/modals**: follow the standard spacing pattern in the repo root `../CLAUDE.md`:
  - `DialogHeader` â†’ body wrapper (`space-y-4` or `space-y-3`) â†’ `DialogFooter` with `pt-4`
  - avoid one-off `mb-*` spacing between header badges and media previews
- **Section Headers**:
  - "Add" actions in card/section headers should use `variant="secondary"` to maintain visual hierarchy (primary actions are usually for saving/confirming in modals).
