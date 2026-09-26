# PageX — Multi-Tenant Static Site Hosting Platform

A pnpm monorepo for hosting multi-tenant static sites with content-addressed blob storage, deployment manifests, automatic compression/optimization, instant deployments, and a Vector-powered usage/metrics pipeline.

---

## Repository Layout

```
pagex/
├── services/
│   ├── console/                    # Next.js UI and native App Router API
│   │   ├── src/app/                # auth, health, deploy, page, usage, and ingest routes
│   │   ├── src/server/api/         # API services, auth, rate limits, Redis, and MinIO
│   │   ├── src/modules/api/        # API Drizzle schema
│   │   ├── drizzle/                # auth migrations
│   │   └── drizzle-api/            # page/deploy/usage migrations
│   └── blob-server/                # Go Caddy server + static_s3 plugin
├── packages/                       # @pagex/{config,types,utils} workspace packages
├── cli/                            # `pagex` CLI — init / deploy / status
├── docker-compose.yml              # dev stack (blob-server, vector, console, db, redis)
├── docker-compose.prod.yml         # production (GHCR images, no build sections)
├── Caddyfile                       # reverse proxy + static_s3 site serving + console :3080
├── .env.example                    # env template (copy to .env)
├── docs/                           # architecture docs (SCHEMA, API, RULES, WORKERS, …)
└── AGENTS.md                       # repo conventions for AI assistants
```

---

## Architecture & Data Flow

PageX combines a Next.js control panel and native management API, a custom Caddy blob-serving plugin written in Go, and shared infrastructure (PostgreSQL, Redis, MinIO/S3). Vector aggregates access logs into usage/metrics, which the console API persists.

```
┌──────────────────────────────┐
│ Console (Next.js)            │
│ UI, Better Auth, native API  │ :3000
└───────┬──────────────┬───────┘
        │              │
        │              │ access logs (caddy_logs)
┌───────▼──────┐  ┌────▼─────┐
│ Blob Server  │  │ Vector   │
│ Caddy + Go   │  │ aggregate│
└───────┬──────┘  └────┬─────┘
        │              │
        │    POST /internal/usage/ingest
        │              │
┌───────▼──────────────▼──────┐
│ Shared Infrastructure        │
│ PostgreSQL, Redis, MinIO/S3  │
└──────────────────────────────┘
```

### Site serving path

1. Caddy extracts the subdomain from the `Host` header → resolves `site_id`
2. Path → blob hash via the active deployment's manifest (MinIO `manifests/{deploymentID}.json`, cached in PostgreSQL LRU)
3. File streamed from MinIO `blobs/{sha256}` with correct `Content-Type`, precompressed `.br`/`.gz`/`.webp` variant negotiation, and range support
4. Atomic activation: a deploy/rollback flips `is_active` in one DB transaction, then bumps the Redis site version to invalidate Caddy's L1 cache

### Metrics & usage pipeline

- **Caddy** writes JSON access logs (with `site_id`, `deployment_id`, `cache_hit`, `from_manifest`) to the shared `/var/log/caddy` volume (`caddy_logs`).
- **Vector** reads those logs, aggregates per site + hour in ~30s windows, and POSTs pre-aggregated records to `POST /internal/usage/ingest` (bearer-token auth via `USAGE_INGEST_TOKEN`).
- **Console API** applies each record transactionally into `bandwidth_usage_hourly` (billing), `service_metrics_hourly` (operational), and `site_daily_stats` (rollup), with idempotent dedup via the `usage_ingest_dedup` table (deterministic `ingest_id`).

**Billing:** only **bandwidth** is metered, in decimal GB (1 GB = 1,000,000,000 bytes). **Requests are unlimited and never billed/quota-checked.**

See [`docs/`](docs/) for full detail.

---

## Getting Started

### Prerequisites

- **Node.js 20.9+** and **pnpm** (8+) — monorepo package manager
- **Go 1.20+** — blob-server (Caddy plugin)
- **Docker & Docker Compose** — full local stack
- **MinIO/S3** — external object storage (or a compose service)

### Quick start (Docker)

```bash
cp .env.example .env       # fill in required values (see below)
docker compose up -d       # blob-server, vector, console, db, redis
```

Wait for containers to be healthy, then:

- **Console UI and API:** http://localhost:3000
- **PostgreSQL:** localhost:5432 (db `pagex`)
- **Redis:** localhost:6379

### Local development (no Docker)

The console is a normal Node app; point it at the same Neon and Upstash
projects you use in production and run it directly:

```bash
pnpm install
pnpm dev:console         # Next.js UI and native API
pnpm dev:blob-server     # Go Caddy `go run ./cmd/caddy`
```

No hostnames or ports to remap — there is no local Postgres or Redis to run.

---

## Required Environment Variables

Strictly required to run anything against infra (see `.env.example` for the full list):

| Variable | Description |
|---|---|
| `BETTER_AUTH_SECRET` | Better Auth secret (32+ hex chars — `openssl rand -hex 32`) |
| `BASE_DOMAIN` | Base domain for site subdomains (`localhost` for local dev) |
| `DATABASE_URL` | Neon Postgres connection string (use the `-pooler` host) |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST credentials |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | MinIO/S3 credentials |
| `MINIO_ENDPOINT_URL` | MinIO/S3 endpoint (must include scheme) + `MINIO_BUCKET` |
| `USAGE_INGEST_TOKEN` | Shared secret for the Vector → console ingest endpoint |

Optional: `TLS_CFG` (tls-off locally, tls-on in prod, needs `CLOUDFLARE_API_TOKEN`), `REDIRECT_TO_S3`/`PRESIGN_REDIRECT` (direct S3 downloads), SMTP + OAuth keys.

---

## Useful Commands (from repo root)

```bash
pnpm install                  # install all workspace deps (pnpm only)
pnpm build                       # build all packages + services
pnpm dev:console / dev:blob-server
pnpm test:console                # API utility tests
pnpm test:blob-server            # Go tests
pnpm lint                        # Biome format (format-only, not a real lint)
pnpm db:generate / db:migrate    # auth and API Drizzle migrations
```

### Production

`docker-compose.prod.yml` has **no `build:` sections** — it pulls versioned images from GHCR (`ghcr.io/mahadi-rsio/pagex/{console,blob-server}`). Images are published by the `.github/workflows/*-publish.yml` workflows on service version tags (`console/v1.5.0`, `blob-server/v1.5.0`).

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

Defaults: `PAGEX_API_URL=http://localhost:3000`, `PAGEX_AUTH_URL=http://localhost:3000`; session stored at `~/.pagex.session.json`.

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