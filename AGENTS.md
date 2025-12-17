# Polemicyst web/app package — agent entrypoint

If you’re working anywhere under `polemicyst.com/`, read the repo-level guide first:

- `../AGENTS.md`

This package contains the **Next.js app**, plus the **backend** and **workers** used in local dev via Docker Compose.

## Common commands (run from `polemicyst.com/`)

- Web UI dev: `npm run dev` (Next uses `--experimental-https`)
- Web build: `npm run build`
- Full stack (db/redis/backend/workers hot reload):  
  `docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build`

## Key files

- Next App Router: `src/app/*`
- Next API routes: `src/app/api/*`
- Prisma schema: `prisma/schema.prisma` (client: `shared/lib/prisma.ts`)
- Backend (Express): `backend/`
- Clip workers: `clip-worker/`
- Poller worker: `workers/`

## UI conventions (quick reminders)

- **Dialogs/modals**: follow the standard spacing pattern in the repo root `../CLAUDE.md`:
  - `DialogHeader` → body wrapper (`space-y-4` or `space-y-3`) → `DialogFooter` with `pt-4`
  - avoid one-off `mb-*` spacing between header badges and media previews


