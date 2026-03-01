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

Cloud agents run in an isolated VM without Docker. You MUST start services manually before the dev server will work.

### Environment setup (run at session start)

1. **Start PostgreSQL and Redis:** `sudo service postgresql start && sudo service redis-server start`
2. **Set postgres password:** `sudo -u postgres psql -c "ALTER USER postgres WITH PASSWORD 'postgres';"`
3. **Run Prisma migrations:** Use the `DATABASE_URL` from `.env` and run `npx prisma migrate deploy`
4. **Clear stale cache and start dev server:** `rm -rf .next && npx next dev --port 3000 &`
5. **Wait ~15s, then verify** the server responds with HTTP 200 on port 3000.

### Why this is needed

- The `.env` file has `DATABASE_URL` pointing to the local PostgreSQL instance, but PostgreSQL and Redis are not auto-started in cloud agent VMs.
- A stale `.next` cache can cause CSS/Tailwind to not render (the CSS file returns 404). Always `rm -rf .next` before starting the dev server if styles look broken.
- The SWC binary for linux may need to be installed: `npm install @next/swc-linux-x64-gnu`.

### Testing UI changes

After starting the dev server, use the `computerUse` subagent to open the app in Chrome (port 3000) and verify the page renders with proper Tailwind CSS styling (not unstyled bullet points / plain text).

## UI conventions (quick reminders)

- **Dialogs/modals**: follow the standard spacing pattern in the repo root `../CLAUDE.md`:
  - `DialogHeader` â†’ body wrapper (`space-y-4` or `space-y-3`) â†’ `DialogFooter` with `pt-4`
  - avoid one-off `mb-*` spacing between header badges and media previews
- **Section Headers**:
  - "Add" actions in card/section headers should use `variant="secondary"` to maintain visual hierarchy (primary actions are usually for saving/confirming in modals).
