# Project Context: Next.js Console and Native API

PageX's console is a Next.js 16 monolith with PostgreSQL, Redis, MinIO, Drizzle ORM, and Better Auth. The former Express API is now served by native App Router handlers in the same application.

## Stack

- Next.js 16 App Router and React 19
- TypeScript in strict mode
- Tailwind CSS v4 and shadcn/ui
- PostgreSQL with Drizzle ORM
- Redis with ioredis
- MinIO with the S3 client
- Better Auth with JWT/JWKS
- Zod validation
- Biome 2 formatting
- Caddy for the console reverse proxy and tenant `static_s3` serving

## Structure

```text
services/console/
├── drizzle.config.ts          # Auth migration config
├── drizzle.api.config.ts      # API migration config
├── drizzle/                   # Auth migration history
├── drizzle-api/               # API migration history
├── scripts/                   # Migration and maintenance scripts
├── tests/                     # API utility tests
└── src/
    ├── app/                   # Next.js pages and native route handlers
    │   ├── api/[...path]/     # Public API entry
    │   ├── api/auth/[...all]/ # Better Auth
    │   ├── api/health/        # Console health
    │   ├── api/proxy/[...path]/# Browser API compatibility proxy
    │   ├── health/            # Top-level health alias
    │   ├── internal/usage/    # Token-authenticated usage ingest
    │   └── v1/check-domain/   # Domain check
    ├── db/                    # Pool, migration runner, schema exports
    ├── lib/                   # Shared client/server utilities
    ├── modules/
    │   ├── api/schemas/       # API Drizzle schema
    │   └── auth/              # Better Auth module
    └── server/api/
        ├── constants/         # API limits and pricing
        ├── http/              # Dispatcher, JWT auth, rate limits
        ├── infrastructure/    # DB, Redis, MinIO
        ├── services/          # Business logic
        ├── utils/             # Validation, metrics, usage, errors
        └── validators/        # Zod request schemas
```

## Request Flow

Public `/api/*` requests enter through `src/app/api/[...path]/route.ts`. The dispatcher matches the route, applies Redis rate limiting, verifies the Better Auth JWT through JOSE/JWKS, validates input, and calls a service. Services own PostgreSQL, Redis, and MinIO operations.

`/internal/usage/ingest` uses constant-time validation of `USAGE_INGEST_TOKEN` and bypasses public rate limiting. The Better Auth route remains under `/api/auth/*`.

## Production Model

- `next build` produces the Node.js standalone application by default.
- Root Caddy listens on `:3080` and reverse-proxies the console UI and API to `console:3001`.
- Tenant sites are served by the blob server's `static_s3` Caddy plugin.
- `src/instrumentation.ts` runs auth migrations, API migrations, and conditional bucket initialization in the Node.js runtime.
- The API migration bootstrap records existing pushed API schemas in the original Drizzle migration history before applying new migrations.

## Database

Schemas are defined in `src/modules/[module]/schemas/` and aggregated through `src/db/schema.ts`.

- Auth uses `drizzle.config.ts`, `drizzle/`, and `drizzle.__drizzle_migrations_console`.
- API uses `drizzle.api.config.ts`, `drizzle-api/`, and `drizzle.__drizzle_migrations`.
- Fresh databases run auth migrations first and API migrations second.
- Existing databases retain independent migration histories.

After a schema change:

```bash
pnpm run db:generate
pnpm run db:migrate
```

## Environment

- Client-visible values use `NEXT_PUBLIC_*`; `PUBLIC_URL` is explicitly mapped in `next.config.ts`.
- `BETTER_AUTH_SECRET`, `DATABASE_URL`, and `REDIS_URL` configure the Node runtime.
- `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_BUCKET`, `S3_ACCESS_KEY`, and `S3_SECRET_KEY` configure lazy storage access.
- `BASE_DOMAIN` is used for page domain allocation and validation.
- `USAGE_INGEST_TOKEN` authenticates internal usage ingestion.
- `AUTH_JWKS_URL` can override request-relative JWKS discovery.
- `IN_DOCKER_COMPOSE=1` selects Docker service hostnames for Redis and PostgreSQL-related integrations.

## Commands

```bash
pnpm run dev
pnpm run build
pnpm run test
pnpm run lint
pnpm exec tsc --noEmit
```
