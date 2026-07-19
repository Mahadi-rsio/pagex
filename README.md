# Cloudisy Server

Backend API and infrastructure for **Cloudisy** — a multi-tenant static-site hosting platform. Each user project is served as a subdomain (`mysite.cloudisy.com`) directly from MinIO object storage via a custom Caddy plugin, with zero per-tenant configuration.

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
  ├──▶ MinIO  (object storage — single shared bucket)
  │
  └──▶ Express API  (site management, uploads, analytics)
            │
            ├── PostgreSQL  (sites, pages, site_daily_stats)
            ├── Redis       (tenant UUID cache, usage counters, BullMQ queues)
            └── BullMQ Workers
                    ├── upload  — extracts zip → stores to MinIO under {UUID}/{file}
                    └── sync    — flushes Redis usage counters → PostgreSQL
```

### Key design decisions

| Topic | Decision |
|-------|----------|
| **Routing** | Caddy `static_s3` plugin resolves `subdomain → UUID → S3 key` at request time. No Caddy admin API calls needed. |
| **Storage** | Single shared bucket `cloudisy-sites`. Every tenant's files live under `{site_id}/`. |
| **Analytics** | The plugin writes `site_daily_stats` rows to PostgreSQL directly (Redis → PG flush every 5 min). |
| **Auth** | JWT verified via remote JWKS at `https://cloudisy.vercel.app/api/auth/jwks`. |

---

## Services

| Container | Image / Build | Role |
|-----------|---------------|------|
| `express_app` | `./Dockerfile` | REST API |
| `caddy_server` | `./plugins/Dockerfile` | Caddy + `static_s3` plugin |
| `minio_server` | `minio/minio` | S3-compatible object storage |
| `postgres_db` | `postgres:16-alpine` | Primary database |
| `redis` | `redis:7-alpine` | Cache + BullMQ broker |
| `upload_w` | `./Dockerfile` | Upload queue worker |
| `sync_w` | `./Dockerfile` | Usage sync worker |
| `build_w` | `./Dockerfile` | Cloud build queue worker |

---

## Database Schema

### `sites`
Resolved by the Caddy plugin at request time.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key — used as the MinIO key prefix |
| `subdomain` | TEXT UNIQUE | e.g. `mysite` for `mysite.cloudisy.com` |
| `active` | BOOLEAN | Set to `false` on project deletion; caddy stops routing immediately |
| `created_at` | TIMESTAMPTZ | |

### `pages`
Tenant project metadata managed by the API.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `site_id` | UUID FK → sites | Links to the routing/storage record |
| `tenant_id` | TEXT | Auth provider user ID |
| `tenant_name` | TEXT | |
| `domain` | TEXT | Full domain e.g. `mysite.localhost` |
| `project_name` | TEXT | Subdomain slug |
| `plan` | TEXT | `free` (default) |
| `request` | BIGINT | Cumulative request count (synced from Redis) |
| `bandwidth_usage` | BIGINT | Cumulative bandwidth in bytes |

### `site_daily_stats`
Written by the Caddy `static_s3` plugin's analytics middleware.

| Column | Type | Notes |
|--------|------|-------|
| `site_id` | UUID FK → sites | |
| `date` | DATE | |
| `requests` | BIGINT | Total requests |
| `bandwidth` | BIGINT | Total bytes transferred |
| `requests_2xx / 3xx / 4xx / 5xx` | BIGINT | HTTP status breakdown |
| `humans / bots` | BIGINT | User-agent classification |
| `unique_ips` | BIGINT | HyperLogLog cardinality estimate |
| `peak_hour` | TEXT | `YYYY-MM-DD:HH` |

### `builds`
Records of page build jobs and their statuses.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key — generated random UUID |
| `page_id` | UUID FK → pages | Cascade delete |
| `tenant_id` | TEXT | Same as `pages.tenant_id` |
| `job_id` | TEXT | BullMQ Job ID (nullable) |
| `status` | TEXT | `queued` (default) \| `active` \| `completed` \| `failed` |
| `repo_url` | TEXT | HTTPS URL of GitHub/GitLab repository |
| `git_provider` | TEXT | `github` \| `gitlab` |
| `framework` | TEXT | `nextjs` \| `react` \| `vue` \| `vite` \| `static` |
| `build_command`| TEXT | `pnpm build` (default) |
| `output_dir` | TEXT | Nullable (auto-detected if null) |
| `error` | TEXT | Nullable (captured output on build failure) |
| `triggered_by` | TEXT | `cli` (default) \| `dashboard` |
| `created_at` | TIMESTAMPTZ | Time job was created |
| `completed_at` | TIMESTAMPTZ | Time job completed (nullable) |

---

## API Reference

All protected endpoints require a `Bearer <JWT>` header.

### Health

```
GET /health
```
Returns `{ message: "ok" }`. No auth required.

---

### Pages

#### Create a project
```
POST /api/pages/create
Authorization: Bearer <token>

Body: { "project_name": "mysite" }
```
- Inserts a row into `sites` (generates the UUID used as the MinIO prefix)
- Inserts a row into `pages`
- The Caddy plugin immediately starts routing `mysite.{BASE_DOMAIN}` with no additional config

Response:
```json
{
  "id": "...",
  "site_id": "<uuid>",
  "project_name": "mysite",
  "domain": "mysite.localhost",
  "tenant_id": "...",
  ...
}
```

#### List projects
```
GET /api/pages
Authorization: Bearer <token>
```

#### Get usage stats
```
GET /api/pages/usage/:domain
Authorization: Bearer <token>
```
Returns combined DB + live Redis counters:
```json
{
  "requests": { "used": 1234, "limit": 100000 },
  "bandwidth": { "used_gb": "0.001234", "limit": "1GB" }
}
```

#### Delete a project
```
DELETE /api/pages/:id
Authorization: Bearer <token>
```
- Deletes all MinIO objects under `{site_id}/`
- Sets `sites.active = false` and deletes `site:subdomain` from Redis (Caddy stops routing instantly)
- Deletes the `pages` row (cascades to `site_daily_stats`)

---

### Upload

Deploy a build by uploading a `.zip` file containing your static site output.

```
POST /upload/:pageId
Authorization: Bearer <token>
Content-Type: multipart/form-data

Field: file  (zip archive, max 250 MB)
```

- Verifies the caller owns the page
- Enqueues a BullMQ job that extracts the zip and uploads each file to:
  `cloudisy-sites/{site_id}/{filepath}`

#### Check upload status
```
GET /upload/status/:jobId
Authorization: Bearer <token>
```
Returns `{ jobId, state, failedReason }`.  
`state` is one of: `waiting`, `active`, `completed`, `failed`.

---

### Builds

Trigger and monitor cloud builds from GitHub or GitLab.

#### Trigger a build
```
POST /api/builds
Authorization: Bearer <token>

Body:
{
  "pageId": "<uuid>",
  "repoUrl": "https://github.com/user/repo",
  "gitProvider": "github",
  "gitToken": "ghp_...",
  "framework": "vite",
  "buildCommand": "pnpm build",     // Optional (defaults to pnpm build)
  "outputDir": "dist",              // Optional (auto-detected if null)
  "envVars": { "KEY": "VALUE" }     // Optional environment variables
}
```
- Validates page ownership.
- Enqueues a BullMQ job to clone, build inside Docker, and deploy.
- Returns `201 Created` status with the build details.

#### Get build status
```
GET /api/builds/:buildId
Authorization: Bearer <token>
```
Returns the build details including `status`, `error` (if failed), and `job_id`.

#### List page builds
```
GET /api/builds/page/:pageId
Authorization: Bearer <token>
```
Returns an array of the latest 20 builds for the page.

---

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
| `BASE_DOMAIN` | `localhost` | Base domain for subdomain routing (e.g. `cloudisy.com`) |
| `POSTGRES_USER/PASSWORD/DB` | — | PostgreSQL init vars |

---

## Getting Started

### 1. Prerequisites

- Docker + Docker Compose
- Go (only needed to build the Caddy plugin — handled inside Docker)

### 2. Clone with submodule

```bash
git clone --recurse-submodules <repo-url>
cd cloudisy_server

# If already cloned without submodules:
git submodule update --init --recursive
```

### 3. Configure environment

```bash
cp env .env
# Edit BASE_DOMAIN, DB credentials, MinIO keys, etc.
```

### 4. Run

```bash
docker compose up --build
```

> **First run:** Docker builds Caddy from `plugins/Dockerfile` (compiles the `static_s3` Go plugin). This takes ~2 minutes but is cached on subsequent builds.

### 5. Run migrations

Drizzle migrations are run by the `migrator` service automatically before the app starts.

To run manually (from the host, with Postgres reachable at `DRIZZLE_CONNECTION`):
```bash
npm run migrate
```

After changing `src/infrastructure/db/schema.ts`, generate a new migration and commit it:
```bash
npm run gen
```

---

## Caddy Plugin (`plugins/`)

The `plugins/` directory is a Git submodule pointing to [Mahadi-rsio/cdx_s3](https://github.com/Mahadi-rsio/cdx_s3).

The plugin (`static_s3`) handles:
- **Multi-tenant routing** — resolves `subdomain → site UUID` via Redis cache + PostgreSQL
- **SPA routing** — serves `index.html` as fallback for unknown paths
- **Caching** — LRU cache for small assets, conditional request support (ETag / Last-Modified)
- **Media redirect** — redirects large media files directly to MinIO (saves VPS bandwidth)
- **Analytics** — writes per-site daily stats to `site_daily_stats` using Redis counters flushed every 5 minutes

The Caddyfile at `config/Caddyfile` uses a wildcard site block:
```
*.{$BASE_DOMAIN} {
    static_s3 { ... }
}
```

No Caddy admin API is used — every new site starts being served the moment a row is inserted into the `sites` table.

---

## Development

```bash
# Install dependencies
pnpm install

# Type check
npx tsc --noEmit

# Build
pnpm run build

# Run locally (requires external services)
pnpm run dev
```

---

## Project Structure

```
cloudisy_server/
├── config/
│   └── Caddyfile          # Caddy static_s3 plugin config (wildcard routing)
├── plugins/               # Git submodule — Caddy static_s3 plugin (Go)
├── src/
│   ├── app.ts             # Express app setup, rate limiting
│   ├── server.ts          # Server entrypoint, startup tasks
│   ├── constants/         # Shared constants (domain, limits, cron)
│   ├── controllers/       # Request handlers
│   ├── infrastructure/
│   │   ├── cache/         # Redis client
│   │   ├── db/            # Drizzle ORM (db.ts, schema.ts)
│   │   ├── proxy/         # caddy.ts (stub — no longer used)
│   │   └── storage/       # MinIO client, shared bucket helpers
│   ├── middleware/         # JWT auth middleware
│   ├── queue/
│   │   ├── jobs/          # BullMQ queue definitions
│   │   └── workers/       # upload, sync workers
│   ├── routes/            # Express routers
│   ├── services/          # Business logic (page, upload, sync)
│   ├── types/
│   ├── utils/
│   └── validators/        # Zod schemas
├── docker-compose.yml
├── Dockerfile             # Node.js app image
└── drizzle.config.ts
```
