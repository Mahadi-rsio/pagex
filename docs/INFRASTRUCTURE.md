# PageX — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `blob-server` | `caddy` | `ghcr.io/mahadi-rsio/pagex/blob-server:latest` | Caddy + static_s3 (blob-direct), ports 80/443/3080/2019 |
| `vector` | `vector` | `timberio/vector:0.46.1-alpine` | Access-log aggregation → console ingest |

The console (Next.js UI + native API) is **not** a Compose service — it is deployed to **Vercel**.

**Not in Compose:** Neon Postgres, Upstash Redis, and MinIO/S3 are all external.
**Removed:** the cloud-build stack (BullMQ workers and the Docker build environment). Deploys go through the CLI path only (`/api/deploy/prepare|presign|commit`).

Postgres is **Neon** and Redis is **Upstash** — neither runs in Compose. The console reaches Neon with a single `DATABASE_URL` and talks to Upstash over REST using `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`. Upstash exposes one logical database, so cache keys, deploy tokens, and page deploy locks share a namespaced key space instead of separate DB numbers.

Migrations and bucket provisioning run from `src/instrumentation.ts`. On Vercel this is skipped on serverless cold starts unless `RUN_STARTUP_TASKS=1` is set for that deploy.

---

## Dockerfile Stages

```
FROM caddy:2.11.4-builder AS builder # go build ./cmd/caddy (static_s3 plugin)
FROM caddy:2.11.4-alpine             # blob-server runtime
```

---

## Service Dependencies (startup order)

```
blob-server (:80/:443 sites, :3080 console/API) ──► Neon (sites, deployments, manifests)
                                                └► MinIO/S3 (blobs, manifests)
vector (reads caddy_logs) ──► POST /internal/usage/ingest on the console (Vercel + Upstash)
```

---

## Volumes

| Volume / bind | Mount | Purpose |
|---------------|-------|---------|
| `caddy_logs` | `/var/log/caddy` | Blob-server access logs (read by Vector) |
| `vector_data` | `/var/lib/vector` | Vector state |

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `blob-server` (console vhost) | `3080:3080` |
| `blob-server` | `80`, `443`, `2019` |

---

## Getting Started

```bash
cp .env.example .env
docker compose up -d
```

---

## pnpm Scripts

Run in `services/console`:

| Script | Command | Usage |
|--------|---------|-------|
| `pnpm db:generate` | Separate auth/API Drizzle configs | Generate migrations |
| `pnpm db:migrate` | `tsx scripts/migrate.ts` | Apply both migration histories |
| `pnpm db:push` | Separate auth/API Drizzle configs | Dev-only schema push |

---

## Caddy Plugin (blob-direct)

Image: `ghcr.io/mahadi-rsio/pagex/blob-server:latest` (built locally for dev via `services/blob-server/`). Config: root `Caddyfile`.

1. **Routing** — `subdomain → site_id` → active deployment → manifest
2. **Path map** — deployment manifest lookup: `files` map of path → blob SHA256 (MinIO `manifests/{deploymentID}.json`)
3. **File serving** — stream / redirect from MinIO `blobs/{sha256}` (with Content-Encoding when set)
4. **Console reverse proxy** — `:3080` proxies to the console (`CONSOLE_UPSTREAM`; port 3000 in local dev, the Vercel origin in production)
5. **Access logs** — emitted to `/var/log/caddy` (`caddy_logs` volume), consumed by Vector

Analytics aggregation is done by **Vector + console API**, not in Caddy. Blob-server resolves tenant routing as **LRU → Redis → PostgreSQL** (Redis is the durable distributed lookup layer; PostgreSQL is authoritative) and backfills Redis on a miss. Redis is also used for API caching, rate limiting, and deploy locks.

No per-tenant Caddy config. A site is live once `sites.active=true` and the active deployment has a persisted manifest.

---

## Vector (access-log aggregation → console ingest)

The `vector` service reads the blob-server access logs from the shared `caddy_logs` volume, aggregates them into pre-aggregated hourly usage records, and POSTs them to the console ingest endpoint (`USAGE_API_URL`, e.g. `https://your-app.vercel.app/internal/usage/ingest`) using `USAGE_INGEST_TOKEN`. See `POST /internal/usage/ingest` in `docs/API.md`.
