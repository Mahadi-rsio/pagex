# AGENTS.md — Next.js Monolith (Cloudisy Console)

## Before making changes

Read these three files — they contain essential project context not repeated here:
- `.cursorrules` — agent-specific instructions
- `project.md` — full tech stack, directory structure, DB schema, env vars
- `rules.md` — code quality, Next.js 16, Drizzle, Better Auth conventions

## Commands

| Command | What it does |
|---|---|
| `pnpm install` | Install deps (pnpm only, not npm) |
| `pnpm run dev` | Start Next.js dev server |
| `pnpm run build` | Build (mode depends on `BUILD_MODE` env) |
| `pnpm run lint` | `npx biome format --write` (formats only, no lint check) |
| `pnpm run db:generate` | Drizzle: generate migration after schema change |
| `pnpm run db:migrate` | Drizzle: apply pending migrations |
| `pnpm run db:push` | Drizzle: push schema directly (dev only) |

**No test framework is configured.** There are no tests to run.

## Build modes

Set `BUILD_MODE=export` (static SSG → `out/`) or `BUILD_MODE=standalone` (Node API server). Default local builds are standalone. Dual build is used in Docker. `next.config.ts` maps `PUBLIC_URL` to `env.PUBLIC_URL` for client-side access.

## Project structure

- `src/app/` — App Router routes. UI pages are **client components** (statically exportable). Only `src/proxy.ts` handles network boundary logic (CORS), **not** `middleware.ts`.
- `src/db/` — Drizzle connection (`index.ts`) and aggregated schema exports (`schema.ts`).
- `src/modules/auth/` — All auth logic. Server-side: `getAuthInstance()`/`getSession()` from `auth-utils.ts`. Client-side: `authClient` from `auth-client.ts`.
- `src/components/ui/` — shadcn/ui components (new-york style). `src/components/console/` — app-specific components.
- `@/*` path alias maps to `./src/*`.

## Tech stack quirks

- **Tailwind v4** — no `tailwind.config.js`. Config is CSS-based in `src/app/globals.css`.
- **Biome 2** — the only linter/formatter. VS Code defaults to Biome. Ignore the stale `.prettierrc`.
- **pnpm-workspace.yaml** sets `minimumReleaseAge: 0` to avoid frozen lockfile failures in CI/Docker.
- **shadcn/ui** uses the `@magicui` registry in addition to default (`components.json`).

## Production serving model

Caddy (`:3000`) serves static UI + reverse-proxies `/api/*` → Node app (`:3000`). Console applies Drizzle migrations on startup via `src/instrumentation.ts` (same pattern as the API) — no separate migrator container. CI builds + pushes to GHCR on version tags (`v*`) and manual dispatch.

## Drizzle schema workflow

Schemas live in `src/modules/[module]/schemas/` and are re-exported from `src/db/schema.ts`. After editing a schema, run `pnpm run db:generate` then `pnpm run db:migrate`. Never edit generated migration files in `./drizzle/`.

## Caddy routing

`Caddyfile` imports `caddy/routes.caddy` which defines `app_routes`: static page paths, `/api/*` proxy, `/_next/static/*` with immutable cache, fallback to `index.html`. `caddy/snippets.caddy` has `dynamic_ssg` helpers for SSG shell routes.

## Environment variables

- Client code reads `NEXT_PUBLIC_*` vars normally. `PUBLIC_URL` is also safe — mapped explicitly via `next.config.ts env`.
- For URL fallbacks on client: `process.env.PUBLIC_URL || window.location.origin`.
- `.env.example` is the template; `.env` is used directly.
