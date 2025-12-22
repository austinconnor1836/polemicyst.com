### Dev hot-reload (backend + clip-worker)

Your default `docker-compose.yml` is production-style (build TS → run compiled JS). For fast iteration, use the dev override:

```bash
cd polemicyst.com
docker compose -f docker-compose.yml -f docker-compose.dev.yml up --build
```

Notes:

- `backend` runs `npm run dev` via `ts-node-dev` (hot reload)
- `clip-worker` runs `npm run dev` via `ts-node-dev` (hot reload)
- Source directories are bind-mounted so edits are picked up without rebuilding images
