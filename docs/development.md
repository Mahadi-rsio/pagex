# PageX Development Guide

## Prerequisites

- Node.js 20.9+
- pnpm 8+
- Go 1.20+ for blob-server
- PostgreSQL 16, Redis 7, and MinIO/S3
- Docker Compose for the full local stack

## Setup

```bash
pnpm install
cp .env.example .env
```

Set at least:

- `BETTER_AUTH_SECRET`
- `BASE_DOMAIN`
- `DATABASE_URL`
- `REDIS_URL`
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_BUCKET`
- `S3_ACCESS_KEY`, `S3_SECRET_KEY`
- `USAGE_INGEST_TOKEN`
- OAuth and SMTP values required by the features you are testing

## Run Locally

Run infrastructure separately, set `IN_DOCKER_COMPOSE=0`, then:

```bash
pnpm dev:console
pnpm dev:blob-server
```

The console serves both the UI and native API. Next.js handles `/api/*`, `/health`, `/v1/check-domain`, and `/internal/usage/ingest`. Caddy routes the console through `:3080` and tenant sites through ports 80/443.

## Run with Docker

The repository Compose file is `docker-compose.yml`; the production file pulls GHCR images and has no build stages.

```bash
docker compose --env-file .env up -d
docker compose --env-file .env logs -f
docker compose --env-file .env down
```

Do not use `scripts/docker.sh`; its historical Compose and env paths do not exist in this repository.

## Console and API Layout

```text
services/console/
├── src/app/                         # Next.js pages and route handlers
├── src/server/api/http/             # dispatcher, JWT auth, Redis rate limits
├── src/server/api/services/         # page/deploy/usage business logic
├── src/server/api/infrastructure/   # DB, Redis, MinIO
├── src/modules/api/schemas/         # API schema
├── drizzle/                         # auth migrations
├── drizzle-api/                     # API migrations
├── scripts/                         # migration and maintenance scripts
└── tests/                           # API utility tests
```

## Database Workflow

Auth and API use separate Drizzle configs and migration tracking tables:

- Auth: `drizzle.config.ts` → `drizzle/`
- API: `drizzle.api.config.ts` → `drizzle-api/`
- Aggregated ORM schema: `src/db/schema.ts`

After editing a schema:

```bash
pnpm db:generate
pnpm db:migrate
```

`db:migrate` runs the consolidated migration script and includes compatibility bootstrapping for databases originally applied with `drizzle-kit push`. Never edit generated migrations after they have been applied.

## API Development

Public API requests enter through `src/app/api/[...path]/route.ts` and are dispatched by `src/server/api/http/dispatcher.ts`.

The dispatcher performs:

1. Path/method matching
2. Redis rate limiting
3. Better Auth JWT/JWKS verification
4. Zod validation
5. Service invocation
6. HTTP response mapping

Services own PostgreSQL, Redis, and MinIO access. Use `HttpError` when a service must set an HTTP status.

Internal ingest is token-authenticated with `USAGE_INGEST_TOKEN` and does not use the public JWT or rate limiter.

## Tests and Quality

```bash
pnpm test:console
pnpm test:blob-server
pnpm lint
cd services/console && pnpm exec tsc --noEmit
cd services/console && pnpm run build
```

The console API utility tests use Node's built-in test runner with `tsx`. Blob-server uses Go tests. Biome formats files; it is not a full static lint suite.

## Production Images

The production stack publishes only:

- `console/v*`
- `blob-server/v*`

```bash
pnpm docker:prod
PAGEX_VERSION=1.4.0 pnpm docker:prod
PAGEX_REGISTRY=<registry> pnpm docker:prod
```

## Deployment Safety

- Never await deployment GC from commit or rollback.
- Never store live blobs under `tenant/`; use `blobs/{sha256}`.
- Use `deploy:lock:{pageId}` for per-page deployment serialization.
- Do not add database credentials to Vector.
- Do not introduce queue/build workers; deployment is synchronous.
