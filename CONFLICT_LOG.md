# Investor-readiness chain — cherry-pick onto main

Branch: `feature/investor-readiness-trunk`
Base: `origin/main` @ `14f4d3bb` (PR #235, 2026-03-29)
Source: 54 commits — 29 prerequisites (`fed3fa87..1907c6cc`) + 25 develop fleet (`origin/develop`)
Target: produce a single PR to `main` that brings the full investor-readiness chain over without
disturbing main's 650 prod commits.

## Why 54, not 25

The prior agent (`agent-a354bb59c5a6cf019`) attempted to cherry-pick only the 25 named fleet
commits onto main and hit massive add/add conflicts on `src/lib/plans.ts`, the worker tree, etc.,
because the fleet was authored on top of 29 prior PRs (#233–#263) that are **also not on main**.

Those 29 PRs include the Clipfire rebrand (#259), the minute-based pricing restructure (#255),
the client-side rendering pipeline (#233/#234/#236/#237/#238/#239/#240), quote graphics
(#243/#245), publishing (#241), multi-file compositions (#247), worker build fix (#248), GDPR
(#262), rate limiting (#263), legal copy (#260), and the iOS/Android CI gate (#257). Without
those, every later commit is reaching for symbols that don't exist on main.

The user authorised picking up the full 54 in the task description.

## Conflict resolution playbook (from the task)

| Conflict shape | Default action |
| --- | --- |
| File new in theirs, doesn't exist in main | Take theirs |
| File exists in main, theirs adds orthogonally | Hand-merge |
| File exists in main, theirs wholesale replaces (e.g. `src/lib/plans.ts`) | Take theirs, sanity-check |
| `package.json` / `package-lock.json` | Hand-merge dep list, re-run `npm install` at end |
| `prisma/schema.prisma` | Hand-merge — preserve main's schema, append new models/cols |
| `src/middleware.ts` | Layer additively |
| `next.config.js` | Layer additively |
| `version.json` | Keep main's value until final bump to `0.5.0` |
| Markdown docs | Take theirs |

## Cherry-pick log

All 54 commits landed cleanly. Most picks (52/54) auto-merged without textual conflict.

### Significant conflict resolutions

- **Commit 5813013d (PR #265 — cleanup)**: this was a chore-cleanup that DELETED routes
  (`/clips-genie`, `/sushi-go`, `/donation-splitter`) that don't exist on main. Cherry-pick
  initially staged the residual ADD operations (new `/design-system/layout.tsx`, two stale
  `callbackUrl` repoint edits in `/multiple-file-upload/`, and the reactions editor cleanup
  that removed `fetchWithRetry`). Verified the staged diff matched the commit's actual
  intent (the deletions silently dropped as no-ops because the target files were absent on
  main) and ran `git cherry-pick --continue` to land it.
- **`version.json`**: kept at main's `0.4.9` throughout the chain, then bumped to `0.5.0`
  in a dedicated post-pick commit per the task spec.

### Clean picks (no conflict)

#264, #266, #267, #268, #269, #270, #271, #272, #273, #274, #275, #276, #277, #278, #279,
#280, #281, #282, #283, #284, #285, #286, #287, #288 — all applied via plain
`git cherry-pick -x <sha>`.

