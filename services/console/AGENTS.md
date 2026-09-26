# AGENTS.md — Next.js Monolith (Cloudisy Console)

## Before making changes

Read these files — they contain essential project context not repeated here:
- `project.md` — tech stack, directory structure, database model, environment variables
- `rules.md` — code quality, Next.js 16, Drizzle, API, and Better Auth conventions

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install deps (pnpm only, not npm) |
| `pnpm run dev` | Start Next.js dev server |
| `pnpm run build` | Build (Vercel uses its own serverless output; `output: standalone` applies elsewhere) |
| `pnpm run lint` | `npx biome format --write` (formats only, no lint check) |
| `pnpm run test` | Node test runner for API utility tests |
| `pnpm run db:generate` | Drizzle: generate auth and API migrations after schema changes |
| `pnpm run db:migrate` | Drizzle: apply pending migrations |
| `pnpm run db:push` | Drizzle: push schema directly (dev only) |

Tests use Node's built-in test runner with `tsx`; run `pnpm run test`.

## Build modes

Set `BUILD_MODE=export` (static SSG → `out/`) or `BUILD_MODE=standalone` (Node API server). Default local builds are standalone. Dual build is used in Docker. `next.config.ts` maps `PUBLIC_URL` to `env.PUBLIC_URL` for client-side access.

## Project structure

- `src/app/` — App Router routes. Public API handlers are native route files under `api/` (e.g. `api/pages/route.ts`); internal ingest is at `internal/usage/ingest/route.ts`. UI pages are **client components** (statically exportable). Only `src/proxy.ts` handles auth CORS, **not** `middleware.ts`.
- `src/db/` — Drizzle connection, migration runner, and aggregated auth/API schema exports.
- `src/server/api/` — infrastructure (Postgres/MinIO/Redis clients), HTTP auth, rate limits, and the `withApiAuth` guard. There is no dispatcher.
- `src/features/` — business logic grouped by domain (`projects`, `deployments`, `usage`), with each feature's service and validator colocated.
- `src/modules/auth/` — All auth logic. Server-side: `getAuthInstance()`/`getSession()` from `auth-utils.ts`. Client-side: `authClient` from `auth-client.ts`.
- `src/components/ui/` — shadcn/ui components (new-york style). `src/components/console/` — app-specific components.
- `@/*` path alias maps to `./src/*`.

## Tech stack quirks

- **Tailwind v4** — no `tailwind.config.js`. Config is CSS-based in `src/app/globals.css`.
- **Biome 2** — the only linter/formatter. VS Code defaults to Biome. Ignore the stale `.prettierrc`.
- **pnpm-workspace.yaml** sets `minimumReleaseAge: 0` to avoid frozen lockfile failures in CI/Docker.
- **shadcn/ui** uses the `@magicui` registry in addition to default (`components.json`).

## Production serving model

The console is deployed to **Vercel** (serverless) — there is no console Docker image, and `.github/workflows/` publishes only the blob-server. Root Caddy reverse-proxies the console host to `{$CONSOLE_UPSTREAM}` (the Vercel origin). Postgres is **Neon** (`DATABASE_URL`, `-pooler` host) and Redis is **Upstash** (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, REST protocol).

`src/instrumentation.ts` applies both Drizzle histories and provisions the storage bucket, but returns early on Vercel unless `RUN_STARTUP_TASKS=1`, so serverless cold starts never race on the DDL lock. Set that variable on the one deploy that should migrate.

## Drizzle schema workflow

Schemas live in `src/modules/[module]/schemas/` and are re-exported from `src/db/schema.ts`. Auth uses `drizzle.config.ts` and `drizzle/`; API uses `drizzle.api.config.ts` and `drizzle-api/`. After editing either schema, run `pnpm run db:generate` then `pnpm run db:migrate`. Never edit generated migration files.

## Caddy routing

Root `Caddyfile` proxies the console host to `{$CONSOLE_UPSTREAM}` and serves tenant sites through `static_s3` (S3 + Neon lookups).

## Environment variables

- Client code reads `NEXT_PUBLIC_*` vars normally. `PUBLIC_URL` is also safe — mapped explicitly via `next.config.ts env`.
- For URL fallbacks on client: `process.env.PUBLIC_URL || window.location.origin`.
- Native API storage and ingest also use `BASE_DOMAIN`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `USAGE_INGEST_TOKEN`.
- `DATABASE_POOL_MAX` caps concurrent Postgres connections per serverless instance (default 5).
- `.env.example` is the template; `.env` is used directly.
