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
| `pnpm run build` | Standard Next.js build (local / non-Worker) |
| `pnpm run build:cloudflare` | OpenNext Cloudflare Worker build (`.open-next/`) |
| `pnpm run preview` | Build + `opennextjs-cloudflare preview` (Wrangler local) |
| `pnpm run cf-typegen` | Regenerate `cloudflare-env.d.ts` from `wrangler.jsonc` |
| `pnpm run lint` | `npx biome format --write` (formats only, no lint check) |
| `pnpm run test` | Node test runner for API utility tests |
| `pnpm run db:generate` | Drizzle: generate auth and API migrations after schema changes |
| `pnpm run db:migrate` | Drizzle: apply pending migrations |
| `pnpm run db:push` | Drizzle: push schema directly (dev only) |

Tests use Node's built-in test runner with `tsx`; run `pnpm run test`.

## Build modes

Production console deploys via **OpenNext Cloudflare** (`pnpm run build:cloudflare` → Worker + assets). Local `next dev` still works against Neon/Upstash; Wrangler bindings (`BLOBS`, `HYPERDRIVE`) are declared in `wrangler.jsonc`. `next.config.ts` maps `PUBLIC_URL` to `env.PUBLIC_URL` for client-side access.

## Project structure

- `src/app/` — App Router routes. Public API handlers are native route files under `api/` (e.g. `api/pages/route.ts`); internal ingest is at `internal/usage/ingest/route.ts`. UI pages are **client components** (statically exportable). Only `src/proxy.ts` handles auth CORS, **not** `middleware.ts`.
- `src/db/` — Drizzle connection, migration runner, and aggregated auth/API schema exports.
- `src/server/api/` — infrastructure (Postgres/R2/Redis clients), HTTP auth, rate limits, and the `withApiAuth` guard. There is no dispatcher.
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

The console is deployed to **Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`) — there is no console Docker image, and `.github/workflows/` publishes only the blob-server. Root Caddy reverse-proxies the console host to `{$CONSOLE_UPSTREAM}` (the Worker origin). Postgres is **Neon** through the **Hyperdrive** binding `HYPERDRIVE` (local CLI falls back to `DATABASE_URL`). Object storage uses the native R2 binding **`BLOBS`**. Redis remains **Upstash** (`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`, REST protocol).

Workers never auto-migrate or create buckets. Apply schema with `pnpm db:migrate` against an explicit database. Set `RUN_STARTUP_TASKS=1` only on a deliberate Node admin process that should migrate once. R2 buckets are provisioned via Wrangler / the Cloudflare dashboard.

## Drizzle schema workflow

Schemas live in `src/modules/[module]/schemas/` and are re-exported from `src/db/schema.ts`. Auth uses `drizzle.config.ts` and `drizzle/`; API uses `drizzle.api.config.ts` and `drizzle-api/`. After editing either schema, run `pnpm run db:generate` then `pnpm run db:migrate`. Never edit generated migration files.

## Caddy routing

Root `Caddyfile` proxies the console host to `{$CONSOLE_UPSTREAM}` and serves tenant sites through `static_s3` (S3 + Neon lookups). Tenant routing is layered: the blob-server resolves **LRU → Redis → PostgreSQL** using two Upstash keys written by the console (see `src/server/api/infrastructure/cache/routing.ts`):

- `site:subdomain:<subdomain>` → `site_id` (no TTL; immutable for the project's life; deleted only on permanent project deletion)
- `site:<site_id>:active` → active `deployment_id` (1 h safety TTL; repointed on deploy/rollback)

Writers must run **after** the matching PostgreSQL mutation commits and must never throw (they log and fall back to Postgres). Deploys/rollbacks must never rewrite the subdomain mapping. The blob-server validates every Redis value is a UUID and treats a malformed value as a cache miss, so PostgreSQL repairs the key on the next read (instead of a Postgres cast error surfacing as a 500). Key names are mirrored in `services/blob-server/src/routing.go`.

## Environment variables

- Client code reads `NEXT_PUBLIC_*` vars normally. `PUBLIC_URL` is also safe — mapped explicitly via `next.config.ts env`.
- For URL fallbacks on client: `process.env.PUBLIC_URL || window.location.origin`.
- Console Workers bind `BLOBS` (R2) and `HYPERDRIVE` in `wrangler.jsonc`; secrets for local preview live in `.dev.vars` (gitignored).
- Native API also uses `BASE_DOMAIN` and `USAGE_INGEST_TOKEN`. Blob-server / compose still use S3-compatible MinIO/R2 env vars separately.
- `DATABASE_POOL_MAX` caps concurrent Postgres connections per Worker isolate (default 5).
- `.env.example` is the template; `.env` / `.dev.vars` are used locally.
