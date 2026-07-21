# Cloudisy Server

Backend API and infrastructure for **Cloudisy** — a multi-tenant static-site hosting platform. Each user project is served as a subdomain (`mysite.cloudisy.com`) directly from MinIO object storage via a custom Caddy plugin, with zero per-tenant configuration. Supports cloud builds from Git, versioned deployments, and instant rollback.

---

## AI Documentation

For AI assistants working on this codebase, a dense reference is in `docs/`:

| File | Contents |
|------|----------|
| [docs/SKILL.md](./docs/SKILL.md) | **Start here** — quick orientation + common task recipes |
| [docs/PROJECT.md](./docs/PROJECT.md) | Full file tree, entry points, constants, MinIO/Redis layout |
| [docs/API.md](./docs/API.md) | All HTTP endpoints with request/response shapes |
| [docs/SCHEMA.md](./docs/SCHEMA.md) | All 5 DB tables + Drizzle query patterns + Redis keys |
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
  │  3. Stream file from MinIO:  cloudisy-sites/{UUID}/{path}
  │
  ├──▶ MinIO  (object storage — live files + deployment snapshots)
  │
  └──▶ Express API  (site management, uploads, cloud builds, rollbacks, analytics)
            │
            ├── PostgreSQL  (sites, pages, site_daily_stats, builds, deployments)
            ├── Redis       (tenant UUID cache, usage counters, BullMQ queues)
            └── BullMQ Workers
                    ├── upload  — snapshot → extract zip → deploy to MinIO
                    ├── sync    — flush Redis usage counters → PostgreSQL
                    └── build   — git clone → docker build → snapshot → deploy
                                  (1 GB RAM limit · live stats via SSE · build time metric)
```

### Key design decisions

| Topic | Decision |
|-------|----------|
| **Routing** | Caddy `static_s3` plugin resolves `subdomain → UUID → S3 key` at request time. No Caddy admin API calls needed. |
| **Storage** | Two MinIO prefixes: `{site_id}/` (live files) and `cloudisy-snapshots/{site_id}/v{N}/` (deployment snapshots). |
| **Analytics** | The plugin writes `site_daily_stats` rows to PostgreSQL directly (Redis → PG flush every 5 min). |
| **Auth** | JWT verified via remote JWKS at `https://auth.cloudisy.com/api/auth/jwks`. |
| **Cloud Builds** | Each build runs in an isolated Docker container (`cloudisy-build-env`) with pnpm pre-installed, limited to 1 GB RAM. Live RAM + Net I/O stats are streamed every 2 s via SSE. Total build time is logged as a final metric. |
| **Rollbacks** | Before every deploy (ZIP upload or build), live files are server-side copied to `cloudisy-snapshots/{site_id}/v{N}/`. Only the last **5 snapshots** per page are retained — older rows + objects are pruned automatically. |

---

## Services

| Container | Image / Build | Role |
|-----------|---------------|------|
| `express_app` | `./Dockerfile` (`runner` stage) | REST API |
| `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + `static_s3` plugin |
| `minio_server` | `minio/minio` | S3-compatible object storage |
| `postgres_db` | `postgres:16-alpine` | Primary database |
| `redis` | `redis:7-alpine` | Cache + BullMQ broker |
| `upload_w` | `./Dockerfile` (`runner` stage) | Upload queue worker |
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

### `deployments`
Snapshot and deployment history per page. `is_active = true` marks the live version. `snapshot_prefix` is the MinIO path of this version's file backup.

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

### Uploads
| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/upload/:pageIdOrName` | Upload ZIP file to deploy |

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
| `POST` | `/api/deployments/:deploymentId/rollback` | Instant rollback to any version |

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
           snapshot current live → delete live → upload new → activate → prune
      5. builds row → status: completed, completed_at set
         [Stats] Total Build Duration: N.NNs logged
  → site is live immediately (Caddy reads MinIO per-request)
```

---

## Rollback System

Every deploy (build or ZIP upload) creates a versioned snapshot in MinIO:
- Live files: `cloudisy-sites/{site_id}/`
- Snapshots: `cloudisy-snapshots/{site_id}/v{N}/`

Only the last **5 versions** are retained. Rolling back:
1. `POST /api/deployments/:id/rollback`
2. Current live → backed up to active version's snapshot path
3. Target snapshot → copied to live prefix
4. `is_active` flags flipped in DB
5. Site live immediately — no restart

---

## Development

```bash
npm run build   # compile TypeScript
npm run gen     # generate migration
npm run migrate # apply migration
node test.js    # end-to-end test (update TOKEN constant first)
```

---

## Project Structure

```
src/
├── app.ts / server.ts          # Express setup + entrypoint
├── constants/index.ts           # Shared constants
├── middleware/auth.middleware.ts # JWT verification
├── infrastructure/
│   ├── db/schema.ts             # 5 Drizzle table definitions
│   ├── cache/redis.ts           # ioredis client
│   └── storage/minio.ts        # MinIO client + copy/delete helpers
├── controllers/                 # Thin HTTP handlers
├── services/                    # Business logic
│   ├── deployment.service.ts    # executeDeploymentFlow + rollback
│   ├── build.service.ts
│   ├── page.service.ts
│   └── upload.service.ts
├── queue/
│   ├── jobs/                    # Queue + job data interfaces
│   └── workers/                 # build, upload, sync workers
├── routes/                      # Express routers
└── validators/                  # Zod schemas
docs/                            # AI-optimized codebase documentation
drizzle/                         # Migration SQL files
```
