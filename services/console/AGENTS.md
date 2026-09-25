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
| `pnpm run build` | Build (mode depends on `BUILD_MODE` env) |
| `pnpm run lint` | `npx biome format --write` (formats only, no lint check) |
| `pnpm run test` | Node test runner for API utility tests |
| `pnpm run db:generate` | Drizzle: generate auth and API migrations after schema changes |
| `pnpm run db:migrate` | Drizzle: apply pending migrations |
| `pnpm run db:push` | Drizzle: push schema directly (dev only) |

Tests use Node's built-in test runner with `tsx`; run `pnpm run test`.

## Build modes

Set `BUILD_MODE=export` (static SSG → `out/`) or `BUILD_MODE=standalone` (Node API server). Default local builds are standalone. Dual build is used in Docker. `next.config.ts` maps `PUBLIC_URL` to `env.PUBLIC_URL` for client-side access.

## Project structure

- `src/app/` — App Router routes. Public API handlers enter through `api/[...path]/route.ts`; internal ingest is at `internal/usage/ingest/route.ts`. UI pages are **client components** (statically exportable). Only `src/proxy.ts` handles auth CORS, **not** `middleware.ts`.
- `src/db/` — Drizzle connection, migration runner, and aggregated auth/API schema exports.
- `src/server/api/` — native API dispatcher, services, HTTP auth/rate limits, Redis, and MinIO.
- `src/modules/auth/` — All auth logic. Server-side: `getAuthInstance()`/`getSession()` from `auth-utils.ts`. Client-side: `authClient` from `auth-client.ts`.
- `src/components/ui/` — shadcn/ui components (new-york style). `src/components/console/` — app-specific components.
- `@/*` path alias maps to `./src/*`.

## Tech stack quirks

- **Tailwind v4** — no `tailwind.config.js`. Config is CSS-based in `src/app/globals.css`.
- **Biome 2** — the only linter/formatter. VS Code defaults to Biome. Ignore the stale `.prettierrc`.
- **pnpm-workspace.yaml** sets `minimumReleaseAge: 0` to avoid frozen lockfile failures in CI/Docker.
- **shadcn/ui** uses the `@magicui` registry in addition to default (`components.json`).

## Production serving model

Root Caddy listens on `:3080` and reverse-proxies the console UI and native API to the Next.js standalone server on port 3001. Console applies both Drizzle histories on startup via `src/instrumentation.ts`; there is no separate API or migrator container. CI builds and pushes the console image to GHCR on version tags (`v*`) and manual dispatch.

## Drizzle schema workflow

Schemas live in `src/modules/[module]/schemas/` and are re-exported from `src/db/schema.ts`. Auth uses `drizzle.config.ts` and `drizzle/`; API uses `drizzle.api.config.ts` and `drizzle-api/`. After editing either schema, run `pnpm run db:generate` then `pnpm run db:migrate`. Never edit generated migration files.

## Caddy routing

Root `Caddyfile` exposes the console on `:3080`, proxies it to `console:3001`, and serves tenant sites through `static_s3`. Console-local Caddy files describe the standalone image's direct reverse-proxy setup.

## Environment variables

- Client code reads `NEXT_PUBLIC_*` vars normally. `PUBLIC_URL` is also safe — mapped explicitly via `next.config.ts env`.
- For URL fallbacks on client: `process.env.PUBLIC_URL || window.location.origin`.
- Native API storage and ingest also use `BASE_DOMAIN`, `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL`, `MINIO_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, and `USAGE_INGEST_TOKEN`.
- `.env.example` is the template; `.env` is used directly.
