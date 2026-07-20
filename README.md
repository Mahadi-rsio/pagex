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
  └──▶ Express API  (site management, uploads, cloud builds, rollbacks, analytics)
            │
            ├── PostgreSQL  (sites, pages, site_daily_stats, builds, deployments)
            ├── Redis       (tenant UUID cache, usage counters, BullMQ queues)
            └── BullMQ Workers
                    ├── upload  — snapshot → extracts zip → deploys to MinIO
                    ├── sync    — flushes Redis usage counters → PostgreSQL
                    └── build   — git clone → docker build → snapshot → deploy
                                  (1 GB RAM limit · live stats via SSE · build time metric)
```

### Key design decisions

| Topic | Decision |
|-------|----------|
| **Routing** | Caddy `static_s3` plugin resolves `subdomain → UUID → S3 key` at request time. No Caddy admin API calls needed. |
| **Storage** | Two MinIO prefixes: `{site_id}/` (live files) and `cloudisy-snapshots/{site_id}/v{N}/` (deployment snapshots). |
| **Analytics** | The plugin writes `site_daily_stats` rows to PostgreSQL directly (Redis → PG flush every 5 min). |
| **Auth** | JWT verified via remote JWKS at `https://cloudisy.vercel.app/api/auth/jwks`. |
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

### `deployments`
Snapshot and deployment history per page. One row per deployment, with `is_active = true` for the currently live version.

| Column | Type | Notes |
|--------|------|-------|
| `id` | UUID | Primary key |
| `page_id` | UUID FK → pages | Cascade delete |
| `site_id` | UUID FK → sites | |
| `tenant_id` | TEXT | |
| `build_id` | UUID FK → builds | Nullable — NULL for ZIP upload deployments |
| `version` | INTEGER | Auto-incrementing per page (1, 2, 3…) |
| `snapshot_prefix` | TEXT | MinIO prefix: `cloudisy-snapshots/{site_id}/v{N}/` |
| `is_active` | BOOLEAN | Only one per page is `true` at a time |
| `source` | TEXT | `build` \| `upload` |
| `file_count` | INTEGER | Number of files in this deployment |
| `created_at` | TIMESTAMPTZ | |

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

Trigger and monitor cloud builds directly from a GitHub or GitLab repository.

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
  "buildCommand": "pnpm build",     // Optional (defaults to "pnpm build")
  "outputDir": "dist",              // Optional (auto-detected: .next, dist, out, build, public)
  "envVars": { "KEY": "VALUE" }     // Optional build-time environment variables
}
```

What happens internally:
1. Validates page ownership (JOIN `pages` + `sites`)
2. Inserts a `builds` row with `status: "queued"`
3. Enqueues a BullMQ job on `cloudisy-cloud-builds`
4. Build worker picks up the job and runs:
   - **Clone** — `git clone --depth=1` with the token injected into the HTTPS URL
   - **Build** — runs `cloudisy-build-env:latest` (pnpm pre-installed) in an isolated container limited to **1 GB RAM**. Live RAM + Net I/O is polled every 2 s and emitted as `[Stats]` log lines via SSE.
   - **Detect** — finds the output dir (auto-detected: `.next`, `dist`, `out`, `build`, `public`) or uses `outputDir`
   - **Snapshot** — server-side copies current live files to `cloudisy-snapshots/{site_id}/v{N}/` before touching live traffic
   - **Deploy** — atomically replaces live files in MinIO; records a `deployments` row and sets `is_active = true`
   - **Finalize** — sets `builds.status = "completed"`, `completed_at`, and logs total build duration
   - **Prune** — deletes any snapshot older than the last 5 versions
5. Returns `201 Created` with the build row

#### Stream build logs (SSE)
```
GET /api/builds/:buildId/logs
Authorization: Bearer <token>
```
Opens a **Server-Sent Events** stream. Each event is a JSON object:

| `type` | Payload | Description |
|--------|---------|-------------|
| `log` | `{ message: string }` | A single log line. Stats lines are prefixed `[Stats]`: e.g. `[Stats] RAM: 350MiB / 1GiB \| Net I/O: 46.8MB / 317kB` or `[Stats] Total Build Duration: 28.84s` |
| `progress` | `{ value: number }` | Build progress 0–100% |
| `status` | `{ status: string }` | Current BullMQ job state |
| `done` | `{ status, error?, durationMs? }` | Final event — includes `durationMs` (ms from `created_at` to `completed_at`). Stream closes after this |
| `error` | `{ message: string }` | Stream-level error |

Example (curl):
```bash
curl -N -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/builds/<buildId>/logs
```

#### Get build status
```
GET /api/builds/:buildId
Authorization: Bearer <token>
```
Returns the full build row including `status`, `error`, `job_id`, `created_at`, `completed_at`.

#### List page builds
```
GET /api/builds/page/:pageId
Authorization: Bearer <token>
```
Returns the latest 20 builds for the page, ordered by `created_at DESC`.

---

### Deployments & Rollbacks

Every successful deploy (ZIP upload or cloud build) creates a versioned snapshot. You can list deployment history and roll back to any of the last 5 versions.

#### List deployments for a page
```
GET /api/deployments/page/:pageId
Authorization: Bearer <token>
```
Returns all deployment records for the page, ordered by `version DESC`. Only one will have `is_active: true`.

Example response:
```json
[
  { "id": "...", "version": 2, "is_active": true,  "source": "build", "file_count": 10, ... },
  { "id": "...", "version": 1, "is_active": false, "source": "build", "file_count": 10, ... }
]
```

#### Rollback to a deployment
```
POST /api/deployments/:deploymentId/rollback
Authorization: Bearer <token>
```
Restores the snapshot at `cloudisy-snapshots/{site_id}/v{N}/` to the live `cloudisy-sites/{site_id}/` prefix. The target deployment is set `is_active = true`; all others for that page become `false`. The site is live on the old version **immediately** — no restart required.

Returns `{ success: true, message: string, deployment: object }`.

> **Snapshot retention:** Only the last **5 versions** per page are retained. After each new deploy, older snapshots (both MinIO objects and DB rows) are pruned automatically.

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
# Create the shared build workspace directory (needed for DinD path sharing)
mkdir -p /tmp/cloudisy-builds

docker compose up --build
```

> **First run:** `docker compose up --build` also builds and tags `cloudisy-build-env:latest` (the pnpm base image used for cloud builds). This is cached after the first run.

> **DinD note:** The `build_w` container mounts `/var/run/docker.sock` to spawn sibling Docker containers for builds. `/tmp/cloudisy-builds` is bind-mounted on both the host and `build_w` so that volume paths in `docker run -v` commands resolve correctly on the host Docker daemon.

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
│   │   ├── jobs/          # BullMQ queue definitions (upload, sync, build)
│   │   └── workers/       # upload.worker, sync.worker, build.worker
│   ├── routes/            # Express routers (page, upload, build, deployment)
│   ├── services/          # Business logic
│   │   ├── deployment.service.ts  # executeDeploymentFlow, rollback, list
│   │   ├── upload.service.ts
│   │   └── build.service.ts
│   ├── types/
│   ├── utils/
│   └── validators/        # Zod schemas (page, build)
├── docker-compose.yml
├── Dockerfile             # Node.js app image
└── drizzle.config.ts
```
