# Cloudisy Server

Backend API and infrastructure for **Cloudisy** — a multi-tenant static-site hosting platform. Each user project is served as a subdomain (`mysite.cloudisy.com`) from content-addressed MinIO blobs via a custom Caddy plugin, with zero per-tenant configuration. Supports cloud builds from Git, CLI blob deploys, versioned deployments, instant rollback, and background blob GC.

---

## AI Documentation

For AI assistants working on this codebase, a dense reference is in `docs/`:

| File | Contents |
|------|----------|
| [docs/SKILL.md](./docs/SKILL.md) | **Start here** — quick orientation + common task recipes |
| [docs/PROJECT.md](./docs/PROJECT.md) | Full file tree, entry points, constants, MinIO/Redis layout |
| [docs/API.md](./docs/API.md) | All HTTP endpoints with request/response shapes |
| [docs/SCHEMA.md](./docs/SCHEMA.md) | All DB tables + Drizzle query patterns + Redis keys |
| [docs/WORKERS.md](./docs/WORKERS.md) | BullMQ job data shapes + worker step-by-step logic |
| [docs/RULES.md](./docs/RULES.md) | Coding conventions, patterns, what NOT to do |
| [docs/INFRASTRUCTURE.md](./docs/INFRASTRUCTURE.md) | Docker services, volumes, ports, Caddy plugin |

---

## Architecture

```
Client
  │
  ▼
Caddy (static_s3 plugin)
  │  1. Extract subdomain from Host header
  │  2. Redis GET "site:{subdomain}"  →  site UUID (short TTL)
  │       miss → SELECT id FROM sites WHERE subdomain=$1 AND active=true
  │  3. Redis HGET "site_files:{site_id}" "{path}"  →  blob SHA256
  │  4. Stream object from MinIO:  {bucket}/blobs/{sha256}
  │
  ├──▶ MinIO  (content-addressed blobs only — external / not in Compose)
  │
  └──▶ Express API  (site management, deploys, cloud builds, rollbacks, analytics)
            │
            ├── PostgreSQL  (sites, pages, site_daily_stats, builds, deployments, blobs, blob_tree_entries)
            ├── Redis
            │     DB0  site:{subdomain}, site_files:{site_id}
            │     DB2  BullMQ
            │     DB3  deploy:token:*, usage counters, db_cache:*
            └── BullMQ Workers
                    ├── sync    — flush Redis usage counters → PostgreSQL
                    └── build   — git clone → docker build → blobs + Redis map
                                  (1 GB RAM limit · live stats via SSE)
```

### Key design decisions

| Topic | Decision |
|-------|----------|
| **Routing** | Caddy resolves `subdomain → site_id → path→blob hash → blobs/{hash}` at request time. No per-tenant Caddy config. |
| **Storage** | Immutable objects at `blobs/{sha256}` only. No `tenant/{site_id}/` live copy — commit is DB + Redis map. |
| **Redis map** | `site_files:{site_id}` hash (path → SHA256, TTL 24h). Rebuilt on every commit/rollback; deleted on page delete. |
| **GC** | After commit/rollback, fire-and-forget `runDeploymentGC`. Keeps **1 active + 10 inactive** (`DEPLOYMENT_RETENTION=10`). Deletes expired deployment rows and truly orphaned MinIO blobs. Never blocks the HTTP response. |
| **Analytics** | The plugin writes `site_daily_stats` rows to PostgreSQL (Redis → PG flush on a cron). |
| **Auth** | JWT verified via JWKS from next-web (`AUTH_JWKS_URL`, default local console `:3080`). |
| **Cloud Builds** | Isolated Docker container (`cloudisy-build-env`) with pnpm, 1 GB RAM. Live RAM + Net I/O via SSE. |
| **Deploys** | CLI: prepare → presign → commit. Limits: ≤100 files, ≤10 MB each; magic-byte + blocked-extension checks; SHA256 dedup. |
| **Optimization** | At commit/build: Brotli + Gzip for text; WebP for PNG/JPEG/GIF. Variants are separate blob tree entries with `Content-Encoding` / `Content-Type` on the blob object. |
| **Rollbacks** | Flip `is_active` + rebuild `site_files:{site_id}` from the target deployment’s tree, then fire GC. |
| **Redis host** | Compose sets `IN_DOCKER_COMPOSE=1` so `REDIS_URL=redis://redis:6379` works in containers. Host scripts remap `redis` → `localhost` (port `6379` published). |

---

## Services

| Container | Image / Build | Role |
|-----------|---------------|------|
| `express_app` | `./Dockerfile` (`runner`) | REST API |
| `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + `static_s3` + console on `:3080` |
| `postgres_db` | `postgres:16-alpine` | Primary database |
| `redis` | `redis:7-alpine` | Cache + BullMQ + `site_files` map (`6379` published for host scripts) |
| `sync_w` | `./Dockerfile` (`runner`) | Usage sync worker |
| `build_w` | `./Dockerfile` (`build-worker`) | Cloud build queue worker — `git` + `docker-cli` |
| `build_env` | `./Dockerfile` (`build-env`) | Tags `cloudisy-build-env:latest` (pnpm) for cloud builds |
| `drizzle_migrator` | `./Dockerfile` (`migrator`) | One-shot schema migrations |
| `next_web` | `ghcr.io/mahadi-rsio/next-web` | Console API + syncs static UI into volume |
| `next_web_migrator` | `config/next-web/Dockerfile.migrator` | One-shot Better Auth schema migrations |

MinIO is **external** (configure `MINIO_ENDPOINT_URL` / credentials in `.env`). There is no `upload_w` — ZIP upload was removed in favor of blob-direct CLI deploys.

**next-web auth DB:** `next_web_migrator` applies Better Auth tables (`user`, `session`, `jwks`, …) into the same Postgres before `next_web` starts (tracked in `next_web_drizzle_migrations`).

**Console UI:** same `caddy_server` listens on **:3080**, serves static from `next_web_static`, proxies `/api/*` → `next_web` (snippets under `config/next-web/caddy/`).

---

## Database Schema

### `sites`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | Site id used in Redis `site_files:{id}` |
| `subdomain` | TEXT UNIQUE | e.g. `mysite` |
| `active` | BOOLEAN | Caddy filters on this |

### `pages`
Tenant metadata. `site_id` FK → sites.

### `site_daily_stats`
Daily analytics written by Caddy plugin. `site_id` FK → sites.

### `builds`
One row per triggered cloud build. Statuses: `queued → active → completed/failed`.

### `blobs`
Content-addressed store. PK = SHA256 hex. Object at `blobs/{hash}` in MinIO.

### `blob_tree_entries`
Per-deployment file tree: `(deployment_id, path) → blob_hash`.

### `deployments`
Deployment history per page. `is_active = true` marks the live version. `files_deployed` / `files_reused` track blob dedup stats.

**Retention:** up to **11** rows per page (1 active + 10 inactive). Older inactive rows and orphaned blobs are removed by background GC.

---

## API Reference (summary)

All protected endpoints require `Authorization: Bearer <JWT>`.

### Pages
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pages/create` | Create new page/site |
| `GET` | `/api/pages` | List tenant's pages |
| `DELETE` | `/api/pages/:id` | Delete page + Redis maps (blobs left until GC / orphan cleanup) |
| `GET` | `/api/pages/usage/:domain` | Live + DB request/bandwidth usage |

### Deploy
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/deploy/prepare` | Validate manifest + issue token + size summary |
| `POST` | `/api/deploy/presign` | Presigned PUTs for missing blobs |
| `POST` | `/api/deploy/commit` | Compress/WebP → blob tree → Redis map → fire GC (5 min timeout) |

### Builds
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/builds` | Trigger cloud build |
| `GET` | `/api/builds/:buildId/logs` | SSE log stream with live stats |
| `GET` | `/api/builds/:buildId` | Get build status |
| `GET` | `/api/builds/page/:pageId` | List last 20 builds |

### Deployments
| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/deployments/page/:pageId` | List deployment history (**page** UUID, not deployment UUID) |
| `POST` | `/api/deployments/:deploymentId/rollback` | Instant rollback via Redis map rebuild + fire GC |

> See [docs/API.md](./docs/API.md) for full request/response shapes.

---

## Environment Variables

Copy `env` to `.env` before starting.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB` | — | PostgreSQL DSN (app / Compose network host `db`) |
| `DRIZZLE_CONNECTION` | — | PostgreSQL DSN for Drizzle Kit (host-side often `localhost`) |
| `REDIS_URL` | `redis://redis:6379` | Redis URL. Compose services keep hostname `redis` via `IN_DOCKER_COMPOSE=1`. Host scripts auto-remap to `localhost`. |
| `MINIO_ENDPOINT` | — | MinIO hostname |
| `MINIO_PORT` | `9000` | MinIO port |
| `MINIO_ENDPOINT_URL` | — | Full MinIO base URL (used by Caddy) |
| `MINIO_USE_SSL` | — | `true` / `false` |
| `S3_ACCESS_KEY` | — | MinIO access key |
| `S3_SECRET_KEY` | — | MinIO secret key |
| `MINIO_BUCKET` | — | Shared bucket name |
| `BASE_DOMAIN` | `localhost` | Base domain for subdomain routing |
| `POSTGRES_USER/PASSWORD/DB` | — | PostgreSQL init vars |
| `IN_DOCKER_COMPOSE` | — | Set to `1` by Compose for app/workers (do not set on host) |
| `BETTER_AUTH_URL` | `http://localhost:3080` | Public URL of the next-web console (Caddy) |
| `BETTER_AUTH_TRUSTED_ORIGINS` | `http://localhost:3080` | Better Auth trusted origins |
| `PUBLIC_URL` | `http://localhost:3080` | Public console origin (must match browser URL) |
| `NEXT_WEB_DATABASE_URL` | (falls back to `DIRECT_DB`) | Optional separate DSN for next-web |
| `BETTER_AUTH_SECRET` | — | Required by next-web (set a long random secret) |
| `ENABLE_EMAIL_PASSWORD` / `NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD` | `true` | Email/password login gates |
| `GITHUB_*` / `GOOGLE_*` / `SMTP_*` / `SENDER` / `BREVO_API_KEY` / `SMS_TOKEN` | — | Optional OAuth / email / SMS |
| `AUTH_JWKS_URL` | `http://localhost:3080/api/auth/jwks` | JWKS for Express JWT verify. Compose overrides to `http://next_web:3000/api/auth/jwks`. |

---

## Getting Started

### Prerequisites
- Docker + Docker Compose
- Reachable MinIO bucket (`MINIO_BUCKET`)

### Steps

```bash
# 1. Clone
git clone --recurse-submodules <repo-url>
cd pagex

# 2. Configure
cp env .env
# Edit BASE_DOMAIN, DB credentials, MinIO keys / endpoint, REDIS_URL, etc.

# 3. Create shared build workspace (DinD requirement)
mkdir -p /tmp/cloudisy-builds

# 4. Start (remove any leftover upload_w orphans)
docker compose up --build --remove-orphans
```

> **First run:** Builds `cloudisy-build-env:latest` (pnpm base image). Migrations run automatically via `drizzle_migrator`.

> **DinD note:** `build_w` mounts `/var/run/docker.sock` and `/tmp/cloudisy-builds`. The host path must exist for volume mounts in build containers to resolve correctly.

### Console (next-web)

After Compose is up:

| Check | URL / command |
|-------|----------------|
| Console UI | http://localhost:3080 |
| Login | http://localhost:3080/login/ |
| Health | `curl -sS http://localhost:3080/api/health` |

Caddy config: site serving in `config/Caddyfile`; console routes imported from `config/next-web/caddy/`. Set `BETTER_AUTH_SECRET` (and any OAuth/SMTP vars) in `.env`. Auth tables are created by `next_web_migrator` on `docker compose up`.

### One-time: purge legacy `tenant/` objects

If you previously served from `tenant/{site_id}/`, clear those objects once (blobs are untouched):

```bash
npx tsx src/scripts/migrate-to-blob-serving.ts
```

### Migrations

```bash
# After changing src/infrastructure/db/schema.ts:
npm run gen      # generate migration SQL
npm run migrate  # apply (also runs automatically on docker compose up)
```

---

## Deploy Pipeline (CLI)

```
POST /api/deploy/prepare
  → validateManifest: ≤100 files, ≤10 MB each, blocked extensions
  → validate magic bytes + extension/MIME checks
  → Redis SET deploy:token:{token} (DB3, TTL 10m)
  → return uploadRequired hashes + summary

POST /api/deploy/presign
  → presigned PUT urls for blobs/{hash}

Client PUTs file bodies to MinIO

POST /api/deploy/commit  (request timeout 5 minutes)
  → load original blobs
  → expand variants:
       .html/.css/.js/.json/.svg/.xml → .br + .gz
       .png/.jpg/.jpeg/.gif → .webp (original kept)
  → store variant blobs (SHA256 of compressed/WebP bytes)
  → insert blob_tree_entries (originals + variants)
  → activate deployment
  → rebuild Redis site_files:{site_id} (DEL → HSET → EXPIRE 24h)
  → DEL site:{subdomain}
  → return summary { sizeReduced, imagesOptimized, … }
  → fire-and-forget runDeploymentGC(pageId, siteId)
```

### Background GC (`runDeploymentGC`)

Runs after every successful commit and rollback. Never awaited by the HTTP handler.

1. Select inactive deployments ordered by `created_at DESC` with `OFFSET 10` (`DEPLOYMENT_RETENTION`)
2. Collect candidate blob hashes from those deployments
3. Cross-check: drop hashes still referenced by non-expired deployments
4. Delete orphaned objects from MinIO (`blobs/{hash}`), batches of 100, concurrency 10
5. In a DB transaction: delete `blob_tree_entries` → `deployments` → successfully deleted `blobs` rows
6. Log: `GC complete: N deployments cleaned, M blobs deleted, X.Y MB freed`

Steady state per page: **≤ 11 deployments** (1 active + 10 inactive).

**Limits / blocked types** (shared by prepare + build worker): PDF, video, executables, archives (`.zip`/`.tar`/…), `.db`/`.sqlite`/`.log`, etc. See `src/utils/deployment-validator.ts`.

---

## Build Pipeline (step by step)

```
POST /api/builds
  → builds row inserted (status: queued)
  → BullMQ job enqueued on cloudisy-cloud-builds
  → build_w picks up job:
      1. git clone --depth=1 (token injected)
      2. docker run cloudisy-build-env:latest --memory 1g
         (pnpm install && <buildCommand>)
         → [Stats] logs streamed every 2s via SSE
      3. output dir detected (.next / dist / out / build / public)
      4. validateOutputDir (same count/size/extension rules as prepare)
         on failure → builds.status=failed, SSE error, return cleanly
      5. deployFromLocalDirectory:
           hash → Brotli/Gzip/WebP → blobs + tree → Redis map → fire GC
           → [Summary] line in SSE
      6. builds row → status: completed, completed_at set
  → site is live immediately (Caddy reads blobs via Redis map)
```

---

## Rollback System

Every deploy (CLI or build) records a blob tree in PostgreSQL. Serving uses:

- Blobs: `{bucket}/blobs/{sha256}`
- Map: Redis `site_files:{site_id}` → path → hash

Rolling back:

1. `POST /api/deployments/:id/rollback`
2. Flip `is_active` flags
3. Rebuild `site_files:{site_id}` from the target tree
4. Invalidate `site:{subdomain}`
5. Fire-and-forget GC
6. Site live immediately — no MinIO copy, no restart

---

## Development

```bash
npm run build   # compile TypeScript
npm run gen     # generate migration
npm run migrate # apply migration

# End-to-end test (paste JWT into test.js or export CLOUDISY_TOKEN)
node test.js

# CLI deploy + validation + summary only (skip cloud build)
SKIP_BUILD=1 node test.js
```

`test.js` covers: blocked-extension prepare rejection, CLI deploy with Brotli/Gzip/WebP + prepare/commit summaries, blob reuse, rollback, optional cloud build + SSE `[Summary]`.

Rebuild API + workers after local changes:

```bash
docker compose up --build -d --remove-orphans app build_worker sync_worker
```

---

## Project Structure

```
src/
├── app.ts / server.ts           # Express setup + entrypoint
├── constants/index.ts           # Shared constants (incl. DEPLOYMENT_RETENTION=10)
├── middleware/auth.middleware.ts # JWT verification
├── infrastructure/
│   ├── db/schema.ts             # Drizzle table definitions
│   ├── cache/redis.ts           # ioredis (DB0 site/site_files, DB2 BullMQ, DB3 usage)
│   └── storage/minio.ts         # MinIO client + blob helpers + deleteBlobObjects
├── controllers/                 # Thin HTTP handlers
├── services/                    # Business logic
│   ├── deploy.service.ts        # prepare / presign / commit + compress/WebP + Redis map
│   ├── deployment.service.ts    # list + rollback
│   ├── gc.service.ts            # background deployment + blob GC
│   ├── build.service.ts
│   └── page.service.ts
├── queue/
│   ├── jobs/                    # Queue + job data interfaces
│   └── workers/                 # build.worker, sync.worker
├── routes/                      # Express routers
├── scripts/
│   └── migrate-to-blob-serving.ts  # one-off delete of legacy tenant/ objects
├── utils/
│   ├── file-validator.ts        # Magic-byte + extension checks
│   └── deployment-validator.ts  # File count / size / blocked-type limits
└── validators/                  # Zod schemas
docs/                            # AI-optimized codebase documentation
drizzle/                         # Migration SQL files
test.js                          # E2E deploy + build smoke test
```
