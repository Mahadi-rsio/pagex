# Project Context: Next.js Console and Native API

PageX's console is a Next.js 16 monolith with PostgreSQL (Neon via Hyperdrive), Redis (Upstash), R2 object storage, Drizzle ORM, and Better Auth. It deploys to Cloudflare Workers through OpenNext.

## Stack

- Next.js 16 App Router and React 19
- TypeScript in strict mode
- Tailwind CSS v4 and shadcn/ui
- PostgreSQL with Drizzle ORM (`pg` + Hyperdrive in Workers)
- Redis with Upstash (`@upstash/redis`, REST protocol)
- Cloudflare R2 via the native `BLOBS` Worker binding
- Better Auth with JWT/JWKS (password + OAuth only; no email or phone OTP)
- Zod validation
- Biome 2 formatting
- Caddy for the console reverse proxy and tenant `static_s3` serving

## Structure

```text
services/console/
├── wrangler.jsonc             # Worker bindings (BLOBS, HYPERDRIVE)
├── open-next.config.ts        # OpenNext Cloudflare adapter
├── drizzle.config.ts          # Auth migration config
├── drizzle.api.config.ts      # API migration config
├── drizzle/                   # Auth migration history
├── drizzle-api/               # API migration history
├── scripts/                   # Migration and maintenance scripts
├── tests/                     # API utility tests
└── src/
    ├── app/                   # Next.js pages and native route handlers
    │   ├── api/               # Public API routes (incl. deploy/blob)
    │   ├── api/auth/[...all]/ # Better Auth
    │   ├── api/health/        # Console health
    │   ├── internal/usage/    # Token-authenticated usage ingest
    │   └── ...
    ├── db/                    # Pool, migration runner, schema exports
    ├── features/              # Domain services (projects, deployments, …)
    ├── lib/                   # Shared client/server utilities
    ├── modules/
    │   ├── api/schemas/       # API Drizzle schema
    │   └── auth/              # Better Auth module
    └── server/api/
        ├── constants/         # API limits and pricing
        ├── http/              # Auth guard, rate limits
        ├── infrastructure/    # DB, Redis, R2
        └── ...
```

## Request Flow

Public `/api/*` requests are native App Router handlers under `src/app/api/`, wrapped with `withApiAuth`. Services own PostgreSQL, Redis, and R2 operations.

`/internal/usage/ingest` uses constant-time validation of `USAGE_INGEST_TOKEN` and bypasses public rate limiting. The Better Auth route remains under `/api/auth/*`.

## Production Model

- `pnpm run build:cloudflare` produces the OpenNext Worker (`.open-next/`).
- Root Caddy reverse-proxies the console host to `{$CONSOLE_UPSTREAM}` (the Worker origin).
- Tenant sites are served by the blob server's `static_s3` Caddy plugin (same `blobs/` / `manifests/` key layout).
- `src/instrumentation.ts` never migrates on Workers cold starts; migrations run via `pnpm db:migrate` or an opt-in Node admin process (`RUN_STARTUP_TASKS=1`).

## Database

Schemas are defined in `src/modules/[module]/schemas/` and aggregated through `src/db/schema.ts`.

- Auth uses `drizzle.config.ts`, `drizzle/`, and `drizzle.__drizzle_migrations_console`.
- API uses `drizzle.api.config.ts`, `drizzle-api/`, and `drizzle.__drizzle_migrations`.

After a schema change:

```bash
pnpm run db:generate
pnpm run db:migrate
```

## Environment

- Client-visible values use `NEXT_PUBLIC_*`; `PUBLIC_URL` is explicitly mapped in `next.config.ts`.
- Workers: `HYPERDRIVE` + `BLOBS` bindings; Upstash REST credentials as secrets / `.dev.vars`.
- Local CLI / migrations: `DATABASE_URL` (Neon).
- `BASE_DOMAIN` is used for page domain allocation and validation.
- `USAGE_INGEST_TOKEN` authenticates internal usage ingestion.
- Email and SMS delivery are not configured (no SMTP / Brevo / email OTP / phone OTP).

## Commands

```bash
pnpm run dev
pnpm run build:cloudflare
pnpm run preview
pnpm run test
pnpm run lint
pnpm run typecheck
pnpm run cf-typegen
```
