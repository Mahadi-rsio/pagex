# Cloudisy Server

Backend API and infrastructure for **Cloudisy** — a multi-tenant static-site hosting platform. Each user project is served as a subdomain (`mysite.cloudisy.com`) directly from MinIO object storage via a custom Caddy plugin, with zero per-tenant configuration. Supports cloud builds from Git, content-addressed file deploys, versioned deployments, and instant rollback.

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
  │  2. Redis GET "site:{subdomain}"  →  UUID (5 min TTL)
  │       miss → SELECT id FROM sites WHERE subdomain=$1 AND active=true
  │  3. Stream file from MinIO:  cloudisy-sites/tenant/{UUID}/{path}
  │
  ├──▶ MinIO  (live files + content-addressed blobs)
  │
  └──▶ Express API  (site management, deploys, cloud builds, rollbacks, analytics)
            │
            ├── PostgreSQL  (sites, pages, site_daily_stats, builds, deployments, blobs, blob_tree_entries)
            ├── Redis       (DB2 BullMQ · DB3 deploy tokens / usage · site cache)
            └── BullMQ Workers
                    ├── sync    — flush Redis usage counters → PostgreSQL
                    └── build   — git clone → docker build → index blobs → deploy
                                  (1 GB RAM limit · live stats via SSE · build time metric)
```

### Key design decisions

| Topic | Decision |
|-------|----------|
| **Routing** | Caddy `static_s3` plugin resolves `subdomain → UUID → S3 key` at request time. No Caddy admin API calls needed. |
| **Storage** | Live files at `tenant/{site_id}/`. Immutable blobs at `blobs/{sha256}`. Deployment trees in `blob_tree_entries`. |
| **Analytics** | The plugin writes `site_daily_stats` rows to PostgreSQL directly (Redis → PG flush every 5 min). |
| **Auth** | JWT verified via remote JWKS at `https://auth.cloudisy.com/api/auth/jwks`. |
| **Cloud Builds** | Each build runs in an isolated Docker container (`cloudisy-build-env`) with pnpm pre-installed, limited to 1 GB RAM. Live RAM + Net I/O stats are streamed every 2 s via SSE. |
| **Deploys** | CLI uses prepare → presign → commit. Magic-byte validation; blob deduplication by SHA256. |
| **Rollbacks** | Rebuild live prefix from the target deployment’s `blob_tree_entries`. Last **5** deployments retained per page. |

---

## Services

| Container | Image / Build | Role |
|-----------|---------------|------|
| `express_app` | `./Dockerfile` (`runner` stage) | REST API |
| `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + `static_s3` plugin |
| `minio_server` | `minio/minio` | S3-compatible object storage |
| `postgres_db` | `postgres:16-alpine` | Primary database |
| `redis` | `redis:7-alpine` | Cache + BullMQ broker |
| `sync_w` | `./Dockerfile` (`runner` stage) | Usage sync worker |
| `build_w` | `./Dockerfile` (`build-worker` stage) | Cloud build queue worker — has `git` + `docker-cli` |
| `build_env` | `./Dockerfile` (`build-env` stage) | Builds & tags `cloudisy-build-env:latest` (pnpm pre-installed) used by cloud builds |

---

## Database Schema

### `sites`
| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID PK | MinIO key prefix |
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

---

## API Reference (summary)

All protected endpoints require `Authorization: Bearer <JWT>`.

### Pages
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/pages/create` | Create new page/site |
| `GET` | `/api/pages` | List tenant's pages |
| `DELETE` | `/api/pages/:id` | Delete page + MinIO files |
| `GET` | `/api/pages/usage/:domain` | Live + DB request/bandwidth usage |

### Deploy
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/deploy/prepare` | Validate manifest + issue deploy token |
| `POST` | `/api/deploy/presign` | Presigned PUTs for missing blobs |
| `POST` | `/api/deploy/commit` | Materialize live site from blob tree |

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
| `GET` | `/api/deployments/page/:pageId` | List deployment history |
| `POST` | `/api/deployments/:deploymentId/rollback` | Instant rollback via blob tree |

> See [docs/API.md](./docs/API.md) for full request/response shapes.

---

## Environment Variables

Copy `env` to `.env` before starting.

| Variable | Default | Description |
|----------|---------|-------------|
| `DB` | — | PostgreSQL DSN (used by the app) |
| `DRIZZLE_CONNECTION` | — | PostgreSQL DSN for Drizzle Kit migrations |
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL |
| `MINIO_ENDPOINT` | `minio_server` | MinIO hostname |
| `MINIO_PORT` | `9000` | MinIO port |
| `S3_ACCESS_KEY` | `minioadmin` | MinIO access key |
| `S3_SECRET_KEY` | `minioadmin` | MinIO secret key |
| `MINIO_BUCKET` | `cloudisy-sites` | Shared bucket name |
| `BASE_DOMAIN` | `localhost` | Base domain for subdomain routing |
| `POSTGRES_USER/PASSWORD/DB` | — | PostgreSQL init vars |

---

## Getting Started

### Prerequisites
- Docker + Docker Compose

### Steps

```bash
# 1. Clone
git clone --recurse-submodules <repo-url>
cd pagex

# 2. Configure
cp env .env
# Edit BASE_DOMAIN, DB credentials, MinIO keys, etc.

# 3. Create shared build workspace (DinD requirement)
mkdir -p /tmp/cloudisy-builds

# 4. Start
docker compose up --build
```

> **First run:** Builds `cloudisy-build-env:latest` (pnpm base image). Migrations run automatically via `drizzle_migrator`.

> **DinD note:** `build_w` mounts `/var/run/docker.sock` and `/tmp/cloudisy-builds`. The host path must exist for volume mounts in build containers to resolve correctly.

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
  → validate magic bytes + extensions
  → Redis SET deploy:token:{token} (DB3, TTL 10m)
  → return uploadRequired hashes

POST /api/deploy/presign
  → presigned PUT urls for blobs/{hash}

Client PUTs file bodies to MinIO

POST /api/deploy/commit
  → insert blobs + blob_tree_entries
  → materialize tenant/{site_id}/ from blobs
  → activate deployment, prune to last 5
  → DEL site:{subdomain}
```

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
      4. executeDeploymentFlow:
           delete live → upload new → index blobs/tree → activate → prune
      5. builds row → status: completed, completed_at set
  → site is live immediately (Caddy reads MinIO per-request)
```

---

## Rollback System

Every deploy (CLI or build) records a blob tree:
- Live files: `cloudisy-sites/tenant/{site_id}/`
- Blobs: `cloudisy-sites/blobs/{sha256}`

Only the last **5 versions** are retained. Rolling back:
1. `POST /api/deployments/:id/rollback`
2. Materialize target `blob_tree_entries` → live prefix
3. `is_active` flags flipped in DB
4. Invalidate `site:{subdomain}`
5. Site live immediately — no restart

---

## Development

```bash
npm run build   # compile TypeScript
npm run gen     # generate migration
npm run migrate # apply migration
node test.js    # end-to-end deploy + rollback test (update TOKEN first)
```

---

## Project Structure

```
src/
├── app.ts / server.ts          # Express setup + entrypoint
├── constants/index.ts           # Shared constants
├── middleware/auth.middleware.ts # JWT verification
├── infrastructure/
│   ├── db/schema.ts             # Drizzle table definitions
│   ├── cache/redis.ts           # ioredis clients (default + DB3 usage)
│   └── storage/minio.ts        # MinIO client + helpers
├── controllers/                 # Thin HTTP handlers
├── services/                    # Business logic
│   ├── deploy.service.ts        # prepare / presign / commit
│   ├── deployment.service.ts    # executeDeploymentFlow + rollback
│   ├── build.service.ts
│   └── page.service.ts
├── queue/
│   ├── jobs/                    # Queue + job data interfaces
│   └── workers/                 # build, sync workers
├── routes/                      # Express routers
├── utils/file-validator.ts      # Magic-byte + extension checks
└── validators/                  # Zod schemas
docs/                            # AI-optimized codebase documentation
drizzle/                         # Migration SQL files
```
