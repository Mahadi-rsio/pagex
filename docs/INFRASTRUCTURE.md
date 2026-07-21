# Cloudisy — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `app` | `express_app` | `Dockerfile` → `runner` stage | REST API (port 3000) |
| `caddy_server` | `caddy_server` | `ghcr.io/mahadi-rsio/cdx_s3` | Caddy + static_s3 plugin |
| `minio_server` | `minio_server` | `minio/minio` | S3-compatible object storage |
| `postgres_db` | `postgres_db` | `postgres:16-alpine` | PostgreSQL database |
| `redis` | `redis` | `redis:7-alpine` | Cache + BullMQ broker |
| `upload_worker` | `upload_w` | `Dockerfile` → `runner` stage | Upload queue worker |
| `sync_worker` | `sync_w` | `Dockerfile` → `runner` stage | Usage sync cron worker |
| `build_worker` | `build_w` | `Dockerfile` → `build-worker` stage | Cloud build worker (has `git` + `docker-cli`) |
| `build_env` | `build_env` | `Dockerfile` → `build-env` stage | Builds `cloudisy-build-env:latest` (pnpm base image) |
| `migrator` | `drizzle_migrator` | `Dockerfile` → `migrator` stage | One-shot Drizzle migrations |

---

## Dockerfile Stages

```
FROM node:22-alpine AS builder      # compile TypeScript → dist/
FROM node:22-alpine AS runner        # API + upload/sync workers
FROM node:22-alpine AS build-worker  # runner + git + docker-cli
FROM node:22-slim   AS build-env     # pnpm pre-installed (used as build container)
FROM node:22-alpine AS migrator      # runs drizzle-kit migrate
```

---

## Service Dependencies (startup order)

```
postgres_db  ──┐
redis        ──┤──► drizzle_migrator ──► express_app
               │                     └► upload_w
               │                     └► sync_w
               │                     └► build_w
               └──► minio_server ──► caddy_server
```

Healthchecks ensure `postgres_db` is ready before dependents start.

---

## Volumes

| Volume | Mount | Purpose |
|--------|-------|---------|
| `postgres_data` | `/var/lib/postgresql/data` | Persistent PG data |
| `minio_data` | `/data` | Persistent MinIO objects |
| `/tmp/cloudisy-builds` | `build_w:/tmp/cloudisy-builds` | Build clone directory (host path — required for DinD) |
| `/var/run/docker.sock` | `build_w:/var/run/docker.sock` | Docker socket for spawning sibling containers |

> **DinD note:** Build containers are launched via Docker socket. The host daemon resolves volume paths. `/tmp/cloudisy-builds` **must exist on the host** before starting:
> ```bash
> mkdir -p /tmp/cloudisy-builds
> ```

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `express_app` | `3000:3000` |
| `minio_server` API | `9000:9000` |
| `minio_server` Console | `9001:9001` |
| `postgres_db` | `5432:5432` |
| `redis` | `6379:6379` |
| `caddy_server` | `80:80`, `443:443` |

---

## Build Container (`cloudisy-build-env:latest`)

The `build_env` service builds and tags this image at compose startup. It is used by the build worker to run user builds.

- Base: `node:22-slim`
- pnpm installed globally (`npm install -g pnpm`)
- No app code — purely an execution environment

**Build worker run flags:**
```bash
docker run \
  --rm \
  --name cloudisy-build-{jobId} \
  --memory 1g \
  -v /tmp/cloudisy-builds/{jobId}:/app \
  -w /app \
  --env KEY=VALUE \
  cloudisy-build-env:latest \
  sh -c "(pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && pnpm build"
```

---

## Getting Started

```bash
# 1. Clone
git clone --recurse-submodules <repo-url>
cd pagex

# 2. Configure
cp env .env
# Edit: DB, DRIZZLE_CONNECTION, REDIS_URL, MINIO_*, BASE_DOMAIN

# 3. Create build workspace (DinD requirement)
mkdir -p /tmp/cloudisy-builds

# 4. Start everything
docker compose up --build

# First run builds:
#  - cloudisy-build-env:latest (pnpm base image)
#  - Caddy with static_s3 plugin (pre-built image)
# Migrations run automatically via drizzle_migrator service
```

---

## npm Scripts

| Script | Command | Usage |
|--------|---------|-------|
| `npm run build` | `tsc` | Compile TypeScript |
| `npm run gen` | `drizzle-kit generate` | Generate migration from schema changes |
| `npm run migrate` | `drizzle-kit migrate` | Apply pending migrations |
| `npm run push` | `drizzle-kit push` | Push schema directly (dev only) |

---

## Caddy Plugin

The Caddy `static_s3` plugin (submodule at `plugins/`, image: `ghcr.io/mahadi-rsio/cdx_s3`) handles:

1. **Routing** — resolves `subdomain → site_id` via Redis cache → PostgreSQL
   - Redis key: `site:{subdomain}` (5-min TTL)
   - SQL: `SELECT id FROM sites WHERE subdomain=$1 AND active=true`
2. **File serving** — streams from MinIO: `{SHARED_BUCKET}/tenant/{site_id}/{path}`
3. **SPA fallback** — serves `index.html` for unknown paths
4. **Analytics** — increments `requests:{domain}` and `bandwidth:{domain}` in Redis
5. **Sync** — Redis counters flushed to `site_daily_stats` every 5 min

Config template in `config/Caddyfile`:
```
*.{$BASE_DOMAIN} {
    static_s3 { ... }
}
```

No Caddy admin API is used. A new site is live the moment `sites` row is inserted with `active=true`.
