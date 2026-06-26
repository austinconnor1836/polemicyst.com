# Contributing

Thanks for thinking about contributing to Clipfire. This file is the
short-form pointer to where things live; the canonical engineering rules are
in [`CLAUDE.md`](CLAUDE.md) (project-level) and the per-area `CLAUDE.md`
files inside each subdirectory.

## Before you start

- Read the [README](README.md) for product context and the documentation
  map.
- Read [`CLAUDE.md`](CLAUDE.md) — every change must comply with the coding
  conventions, Prisma rules, and release process it documents.
- For system topology (services, queues, data flow), read
  [`ARCHITECTURE.md`](ARCHITECTURE.md).

## Workflow

1. Branch from `develop` (never from `main`):
   ```bash
   git checkout develop && git pull && git checkout -b feature/<short-name>
   ```
2. Make changes; keep them focused. Small PRs review faster.
3. Run lint + build + (if applicable) tests locally before pushing.
4. Open a pull request targeting `develop`. Title in the conventional-commits
   style (`feat:`, `fix:`, `chore:`, `docs:`, etc.).
5. CI runs three required suites on every PR: web Lint + Build, Android
   Tests, iOS Tests. Auto-merge is enabled by default; the PR squashes into
   `develop` once all three pass.
6. `develop` → `main` happens via a release PR, not by direct merge. See
   `CLAUDE.md` → "Release process."

## What goes where

- **Next.js web app:** `src/`
- **Shared cross-cutting libs:** `shared/`
- **Express backend:** `backend/`
- **BullMQ workers:** `workers/`
- **Prisma schema + migrations:** `prisma/`
- **iOS:** `ios/`
- **Android:** `android/`
- **Terraform:** `infrastructure/`
- **One-shot scripts:** `scripts/`
- **Documentation:** `docs/`

## Non-negotiables

- **Never** use `prisma db push`. Always `npx prisma migrate dev` for schema
  changes. See `CLAUDE.md` → "Prisma conventions."
- **Never** commit secrets. `ENV_VARS.template` is the reference for required
  env vars; the actual `.env` is gitignored.
- **Never** push directly to `main` or `develop` — always via PR.
- **Never** skip pre-commit hooks (`--no-verify`).
- API routes use `getAuthenticatedUser(req)` from `@shared/lib/auth-helpers`,
  not raw `getServerSession()`. This keeps web and mobile auth unified.

## Reporting a security issue

Do **not** open a public issue for security findings. See
[`SECURITY.md`](SECURITY.md) for the private disclosure process.

## Code of conduct

Be professional. The full text is in
[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md).
