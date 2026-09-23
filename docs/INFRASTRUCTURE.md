# Cloudisy — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `app` | `express_app` | `Dockerfile` → `runner` | REST API (port 3000) |
| `caddy` | `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + static_s3 (blob-direct) + console `:3080` |
| `db` | `postgres_db` | `postgres:16-alpine` | PostgreSQL |
| `redis` | `redis` | `redis:7-alpine` | Cache, rate limiting, deploy locks + site/active_deployment/manifest (port **6379** published) |

**Not in Compose:** MinIO is external (`MINIO_ENDPOINT_URL`).  
**Removed:** `upload_worker` / `upload_w` (ZIP path deleted), and the cloud-build stack (`build_env`, `build_env_loader`, `build_worker`, `build_dind`). Deploys go through the CLI path only (`/api/deploy/prepare|presign|commit`). Use `--remove-orphans` if an old container lingers.

App sets `IN_DOCKER_COMPOSE=1` so `REDIS_URL=redis://redis:6379` keeps the Compose hostname. Host scripts remap `redis` → `localhost`.

Redis and Postgres use healthchecks; the API waits on `redis: service_healthy` and runs migrations on startup.

---

## Dockerfile Stages

```
FROM node:20-alpine AS deps          # npm install
FROM deps AS builder                 # tsc → dist/
FROM node:20-alpine AS runner        # API (default: server.js)
```

---

## Service Dependencies (startup order)

```
db (healthy)     ──► api (runs migrations on startup)
redis (healthy)  ──┤
                 └► blob-server (api + console started; :80/:443 sites, :3080 console)
console (healthy)─┘
```

---

## Volumes

| Volume / bind | Mount | Purpose |
|---------------|-------|---------|
| `pgdata` | `/var/lib/postgresql/data` | Postgres |

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `express_app` | `3000:3000` |
| `caddy_server` (console) | `3080:3080` |
| `postgres_db` | `5432:5432` |
| `redis` | `6379:6379` |
| `caddy_server` | `80`, `443`, `2019` |

---

---

## Getting Started

```bash
cp .env.example .env
docker compose up --build --remove-orphans
```

Optional one-time cleanup of legacy live prefixes:

```bash
npx tsx src/scripts/migrate-to-blob-serving.ts
```

---

## npm Scripts

| Script | Command | Usage |
|--------|---------|-------|
| `npm run build` | `tsc` | Compile TypeScript |
| `npm run gen` | `drizzle-kit generate` | Generate migration |
| `npm run migrate` | `drizzle-kit migrate` | Apply migrations |
| `npm run push` | `drizzle-kit push` | Dev-only schema push |

---

## Caddy Plugin (blob-direct)

Image: `ghcr.io/mahadi-rsio/cdx_s3`. Config: `config/Caddyfile` (+ `config/next-web/caddy/` for console).

1. **Routing** — `subdomain → site_id` via Redis `site:{subdomain}` → Postgres `sites`
2. **Path map** — deployment manifest: `files` map of path → blob SHA256 (MinIO `manifests/{deploymentID}.json` / Redis `manifest:{deploymentId}`)
3. **File serving** — stream / redirect from MinIO `blobs/{sha256}` (with Content-Encoding when set)
4. **Analytics** — `requests:{domain}` / `bandwidth:{domain}` counters
5. **API reverse proxy** — `api.{BASE_DOMAIN}` → `app:3000`
6. **Console** — `:3080` serves next-web static from `/srv`; `/api/*` → `next_web:3000`

No per-tenant Caddy config. A site is live once `sites.active=true` and the active deployment has a persisted manifest.
