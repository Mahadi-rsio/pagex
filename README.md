# PageX — Multi-Tenant Static Site Hosting Platform

A pnpm monorepo for hosting multi-tenant static sites with content-addressed blob storage, deployment manifests, automatic compression/optimization, instant deployments, and a Vector-powered usage/metrics pipeline.

---

## Repository Layout

```
pagex/
├── services/
│   ├── api/                        # Express 5 backend (ESM)
│   │   ├── server.ts               # entrypoint
│   │   ├── controllers/ services/ routes/ validators/ middleware/
│   │   ├── infrastructure/         # db (schema.ts), cache (redis), storage (minio)
│   │   ├── drizzle/                # committed migrations
│   │   └── Dockerfile
│   ├── blob-server/                # Go Caddy server + static_s3 plugin
│   │   ├── src/                    # handler, manifest, blob_fetch, cache (LRU→PostgreSQL)
│   │   ├── vector/                 # vector.yaml: access-log aggregation → API ingest
│   │   ├── Caddyfile / Dockerfile / cmd/caddy
│   │   └── README.md               # blob-server design docs
│   ├── console/                    # Next.js console (Better Auth, Drizzle, Zustand, shadcn/ui)
│   │   └── AGENTS.md               # read before touching the console
│   └── packages/                   # @pagex/{config,types,utils} (workspace-shared)
├── cli/                            # `pagex` CLI — init / deploy / status
├── docker-compose.yml              # dev stack (api, blob-server, vector, console, db, redis)
├── docker-compose.prod.yml         # production (GHCR images, no build sections)
├── Caddyfile                       # reverse proxy + static_s3 site serving + console :3080
├── .env.example                    # env template (copy to .env)
├── docs/                           # architecture docs (SCHEMA, API, RULES, WORKERS, …)
└── AGENTS.md                       # repo conventions for AI assistants
```

---

## Architecture & Data Flow

PageX combines a Next.js control panel, an Express management API, a custom Caddy blob-serving plugin written in Go, and shared infrastructure (PostgreSQL, Redis, MinIO/S3). Vector aggregates access logs into usage/metrics, which the API persists.

```
                ┌─────────────────────┐
                │ Console (Next.js)   │  :3080
                │  Better Auth / UI   │
                └──────────┬──────────┘
                           │
      ┌────────────────────┼────────────────────┐
      │                    │                    │
┌─────▼──────┐      ┌──────▼──────┐      ┌──────▼──────┐
│ API        │      │ Blob Server │      │   Vector    │
│ (Express)  │      │ (Caddy Go)  │      │ aggregation │
│ :3000      │      │ :80/:443    │      │             │
└─────┬──────┘      └──────┬──────┘      └──────┬──────┘
      │                    │                    │
      │        access logs (caddy_logs) ◄───────│
      │                    │                    │
      │              POST /internal/usage/ingest
      │                    │                    │
┌─────┴────────────────────┴────────────────────┴──────┐
│             Shared Infrastructure                     │
│  PostgreSQL (source of truth)   MinIO (blobs)        │
│  Redis (API cache/rate-limit/locks, deploy locks)    │
└──────────────────────────────────────────────────────┘
```

### Site serving path

1. Caddy extracts the subdomain from the `Host` header → resolves `site_id`
2. Path → blob hash via the active deployment's manifest (MinIO `manifests/{deploymentID}.json`, cached in PostgreSQL LRU)
3. File streamed from MinIO `blobs/{sha256}` with correct `Content-Type`, precompressed `.br`/`.gz`/`.webp` variant negotiation, and range support
4. Atomic activation: a deploy/rollback flips `is_active` in one DB transaction, then bumps the Redis site version to invalidate Caddy's L1 cache

### Metrics & usage pipeline

- **Caddy** writes JSON access logs (with `site_id`, `deployment_id`, `cache_hit`, `from_manifest`) to the shared `/var/log/caddy` volume (`caddy_logs`).
- **Vector** reads those logs, aggregates per site + hour in ~30s windows, and POSTs pre-aggregated records to `POST /internal/usage/ingest` (bearer-token auth via `USAGE_INGEST_TOKEN`).
- **API** applies each record transactionally into `bandwidth_usage_hourly` (billing), `service_metrics_hourly` (operational), and `site_daily_stats` (rollup), with idempotent dedup via the `usage_ingest_dedup` table (deterministic `ingest_id`).

**Billing:** only **bandwidth** is metered, in decimal GB (1 GB = 1,000,000,000 bytes). **Requests are unlimited and never billed/quota-checked.**

See [`docs/`](docs/) for full detail.

---

## Getting Started

### Prerequisites

- **Node.js 18+** and **pnpm** (8+) — monorepo package manager
- **Go 1.20+** — blob-server (Caddy plugin)
- **Docker & Docker Compose** — full local stack
- **MinIO/S3** — external object storage (or a compose service)

### Quick start (Docker)

```bash
cp .env.example .env       # fill in required values (see below)
docker compose up -d       # api, blob-server, vector, console, db, redis
```

Wait for containers to be healthy, then:

- **Console UI:** http://localhost:3080
- **API:** http://localhost:3000
- **PostgreSQL:** localhost:5432 (db `pagex`)
- **Redis:** localhost:6379

### Local development (no Docker)

Run PostgreSQL, Redis, and MinIO separately, then:

```bash
pnpm install
pnpm dev:api             # Express API (tsx watch server.ts)
pnpm dev:console         # Next.js console
pnpm dev:blob-server     # Go Caddy `go run ./cmd/caddy`
```

Set `IN_DOCKER_COMPOSE=0` in `.env` when running outside Docker so Redis/MinIO hostnames resolve to `localhost`.

---

## Required Environment Variables

Strictly required to run anything against infra (see `.env.example` for the full list):

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Better Auth secret (32+ hex chars — `openssl rand -hex 32`) |
| `BASE_DOMAIN` | Base domain for site subdomains (`localhost` for local dev) |
| `DB` / `DIRECT_DB` / `NEXT_WEB_DATABASE_URL` | PostgreSQL connection URLs |
| `REDIS_URL` | Redis connection string |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO/S3 credentials |
| `MINIO_ENDPOINT_URL` | MinIO/S3 endpoint (must include scheme) + `MINIO_BUCKET` |
| `USAGE_INGEST_TOKEN` | Shared secret for the Vector → API ingest endpoint |

Optional: `TLS_CFG` (tls-off locally, tls-on in prod, needs `CLOUDFLARE_API_TOKEN`), `REDIRECT_TO_S3`/`PRESIGN_REDIRECT` (direct S3 downloads), SMTP + OAuth keys.

---

## Useful Commands (from repo root)

```bash
pnpm install                  # install all workspace deps (pnpm only)
pnpm build                    # build all packages + services
pnpm dev:api / dev:console / dev:blob-server
pnpm test:blob-server         # Go tests: go test -v ./src/...
pnpm lint                     # Biome format (format-only, not a real lint)
pnpm db:generate / db:migrate # API Drizzle migrations (run in services/api)
```

### Production

`docker-compose.prod.yml` has **no `build:` sections** — it pulls versioned images from GHCR (`ghcr.io/mahadi-rsio/pagex/{api,console,blob-server}`). Images are published by the `.github/workflows/*-publish.yml` workflows on service version tags (`api/v1.5.0`, `console/v1.5.0`, `blob-server/v1.5.0`).

```bash
pnpm docker:prod                              # pull latest + up
PAGEX_VERSION=1.5.0 pnpm docker:prod          # pin a release
PAGEX_REGISTRY=<registry> pnpm docker:prod    # override namespace
```

---

## CLI

The `pagex` CLI handles project init and deployment (`cli/`):

```bash
pagex status                                # auth + current project
pagex init --name my-site                  # create a project + site
pagex deploy                               # build + upload + activate
```

Defaults: `PAGEX_API_URL=http://localhost:3000`, `PAGEX_AUTH_URL=http://localhost:3080`; session stored at `~/.pagex.session.json`.

---

## Documentation Index

- [Architecture](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Database Schema](docs/SCHEMA.md)
- [API Reference](docs/API.md)
- [Infrastructure & Deployment](docs/INFRASTRUCTURE.md)
- [Deploy Pipeline (commit/rollback/GC)](docs/WORKERS.md)
- [Coding Rules](docs/RULES.md)
- [Project Map](docs/PROJECT.md)
- [AI Skill Guide](docs/SKILL.md)

---

## License

MIT — see the [LICENSE](LICENSE) file.