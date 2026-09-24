# PageX — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `api` | `api` | `./services/api/` → `runner` | Express REST API (port 3000) |
| `blob-server` | `caddy` | `ghcr.io/mahadi-rsio/pagex/blob-server:latest` | Caddy + static_s3 (blob-direct), ports 80/443/3080/2019 |
| `vector` | `vector` | `timberio/vector:0.46.1-alpine` | Access-log aggregation → API ingest |
| `console` | `web` | `./services/console/` | Next.js console (port 3001, healthcheck `/api/health`) |
| `db` | `db` | `postgres:16-alpine` | PostgreSQL (port 5432) |
| `redis` | `redis` | `redis:7-alpine` | API cache, rate limiting, deploy locks (port 6379) |

**Not in Compose:** MinIO is external (`MINIO_ENDPOINT_URL`).
**Removed:** the cloud-build stack (BullMQ workers and the Docker build environment). Deploys go through the CLI path only (`/api/deploy/prepare|presign|commit`).

The API sets `IN_DOCKER_COMPOSE=1` so `REDIS_URL=redis://redis:6379` keeps the Compose hostname. Host scripts remap `redis` → `localhost`.

Redis and Postgres use healthchecks; the API waits on `redis: service_healthy` and runs migrations on startup.

---

## Dockerfile Stages

```
FROM node:20-alpine AS deps          # pnpm install
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
                 └► vector (waits on api; reads caddy_logs → POSTs ingest)
```

---

## Volumes

| Volume / bind | Mount | Purpose |
|---------------|-------|---------|
| `pgdata` | `/var/lib/postgresql/data` | Postgres |
| `caddy_logs` | `/var/log/caddy` | Blob-server access logs (read by Vector) |
| `vector_data` | `/var/lib/vector` | Vector state |

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `api` | `3000:3000` |
| `blob-server` (console) | `3080:3080` |
| `db` | `5432:5432` |
| `redis` | `6379:6379` |
| `blob-server` | `80`, `443`, `2019` |

---

## Getting Started

```bash
cp .env.example .env
docker compose up -d
```

---

## pnpm Scripts

Run in `services/api`:

| Script | Command | Usage |
|--------|---------|-------|
| `pnpm db:generate` | `drizzle-kit generate` | Generate migration |
| `pnpm db:migrate` | `drizzle-kit migrate` | Apply migrations |
| `pnpm db:push` | `drizzle-kit push` | Dev-only schema push |

---

## Caddy Plugin (blob-direct)

Image: `ghcr.io/mahadi-rsio/pagex/blob-server:latest` (built locally for dev via `services/blob-server/`). Config: root `Caddyfile`.

1. **Routing** — `subdomain → site_id` → active deployment → manifest
2. **Path map** — deployment manifest lookup: `files` map of path → blob SHA256 (MinIO `manifests/{deploymentID}.json`)
3. **File serving** — stream / redirect from MinIO `blobs/{sha256}` (with Content-Encoding when set)
4. **Console reverse proxy** — `:3080` proxies to the console (port 3001)
5. **Access logs** — emitted to `/var/log/caddy` (`caddy_logs` volume), consumed by Vector

Analytics aggregation is done by **Vector + API**, not in Caddy. Blob-server caches in PostgreSQL (LRU → Postgres); Redis is only used for the API's cache / rate limiting / deploy locks.

No per-tenant Caddy config. A site is live once `sites.active=true` and the active deployment has a persisted manifest.

---

## Vector (access-log aggregation → API ingest)

The `vector` service reads the blob-server access logs from the shared `caddy_logs` volume, aggregates them into pre-aggregated hourly usage records, and POSTs them to the API ingest endpoint (`USAGE_API_URL`, default `http://api:3000/internal/usage/ingest`) using `USAGE_INGEST_TOKEN`. See `POST /internal/usage/ingest` in `docs/API.md`.
