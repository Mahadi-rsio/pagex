# Cloudisy — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `app` | `express_app` | `Dockerfile` → `runner` | REST API (port 3000) |
| `caddy` | `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + static_s3 (blob-direct) |
| `db` | `postgres_db` | `postgres:16-alpine` | PostgreSQL |
| `redis` | `redis` | `redis:7-alpine` | Cache + BullMQ + `site_files` (port **6379** published) |
| `sync_worker` | `sync_w` | `Dockerfile` → `runner` | Usage sync cron |
| `build_worker` | `build_w` | `Dockerfile` → `build-worker` | Cloud builds (`git` + `docker-cli`) |
| `build_env` | (one-shot) | `Dockerfile` → `build-env` | Tags `cloudisy-build-env:latest` |
| `migrator` | `drizzle_migrator` | `Dockerfile` → `migrator` | One-shot Drizzle migrations |

**Not in Compose:** MinIO is external (`MINIO_ENDPOINT_URL`).  
**Removed:** `upload_worker` / `upload_w` (ZIP path deleted). Use `--remove-orphans` if an old container lingers.

App / sync / build workers set `IN_DOCKER_COMPOSE=1` so `REDIS_URL=redis://redis:6379` keeps the Compose hostname. Host scripts remap `redis` → `localhost`.

Redis and Postgres use healthchecks; workers/app wait on `redis: service_healthy` and migrator success. `build_worker` also waits on `build_env` completing.

---

## Dockerfile Stages

```
FROM node:20-alpine AS build-env     # pnpm pre-installed → cloudisy-build-env:latest
FROM node:20-alpine AS deps          # npm install
FROM deps AS migrator                # drizzle-kit migrate
FROM node:20-alpine AS builder       # tsc → dist/
FROM node:20-alpine AS runner        # API + sync worker (default: server.js)
FROM node:20-alpine AS build-worker  # git + docker-cli → build.worker.js
```

---

## Service Dependencies (startup order)

```
postgres_db (healthy) ──► drizzle_migrator ──► express_app
redis (healthy)       ──┤                  └► sync_w
                        │                  └► build_w  ← also waits on build_env
                        └► caddy_server (also needs app started)
```

---

## Volumes

| Volume / bind | Mount | Purpose |
|---------------|-------|---------|
| `pgdata` | `/var/lib/postgresql/data` | Postgres |
| `caddy_data` / `caddy_config` | Caddy state | TLS / config |
| `/tmp/cloudisy-builds` | `build_w:/tmp/cloudisy-builds` | DinD build clones (host path required) |
| `/var/run/docker.sock` | `build_w` | Spawn sibling build containers |

```bash
mkdir -p /tmp/cloudisy-builds
```

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `express_app` | `3000:3000` |
| `postgres_db` | `5432:5432` |
| `redis` | `6379:6379` |
| `caddy_server` | `80`, `443`, `2019` |

---

## Build Container (`cloudisy-build-env:latest`)

Built by the `build_env` service at compose startup.

- Base: `node:20-alpine` + global pnpm
- Used by build worker with `--memory 1g` and host-mounted clone dir

---

## Getting Started

```bash
cp env .env
mkdir -p /tmp/cloudisy-builds
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

Image: `ghcr.io/mahadi-rsio/cdx_s3`. Config: `config/Caddyfile`.

1. **Routing** — `subdomain → site_id` via Redis `site:{subdomain}` → Postgres `sites`
2. **Path map** — Redis `site_files:{site_id}` field = path → value = blob SHA256
3. **File serving** — stream / redirect from MinIO `blobs/{sha256}` (with Content-Encoding when set)
4. **Analytics** — `requests:{domain}` / `bandwidth:{domain}` counters
5. **API reverse proxy** — `api.{BASE_DOMAIN}` → `app:3000`

No per-tenant Caddy config. A site is live once `sites.active=true` and `site_files` is populated by a deploy.
