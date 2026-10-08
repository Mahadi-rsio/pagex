# PageX Console

The PageX console is a Next.js 16 monolith that serves the browser UI, Better Auth, and the native hosting API. Production runs on **Cloudflare Workers** via OpenNext (`@opennextjs/cloudflare`).

## Architecture

| Piece | Role |
|-------|------|
| Cloudflare Workers + OpenNext | Hosts the console — Next.js UI, Better Auth, and native API |
| R2 (`BLOBS` binding) | Content-addressed blobs (`blobs/{hash}`) and immutable manifests |
| Hyperdrive (`HYPERDRIVE`) | Pooled Neon PostgreSQL access from Workers |
| Caddy | Reverse-proxies the console host to `{$CONSOLE_UPSTREAM}` and serves tenant sites with `static_s3` |
| Neon | Managed Postgres for auth and API data (separate Drizzle migration histories) |
| Upstash | Managed Redis (REST) for sessions, caches, rate limits, deploy tokens, and locks |
| Vector | Aggregates Caddy access logs and posts usage to the console |

Public `/api/*` requests are native App Router route files under `src/app/api/`. Each wraps its handler in the `withApiAuth` guard from `src/server/api/http/guard.ts`, which applies rate limiting and authentication (CLI Bearer JWT verified against Better Auth JWKS, or a browser session cookie) exactly once, before the feature service runs. `/internal/usage/ingest` uses `USAGE_INGEST_TOKEN` instead.

Blob uploads use `/api/deploy/blob` (token-gated PUT) rather than S3-style presigned URLs.

## Local Development

From the repository root:

```bash
pnpm install
cp .env.example .env
# For Wrangler / OpenNext preview, also copy secrets into services/console/.dev.vars
pnpm dev:console
```

Next.js defaults to `http://localhost:3000`. When Caddy fronts the application, open `http://localhost:3080`.

Run these checks from `services/console`:

```bash
pnpm run test
pnpm run lint
pnpm run typecheck
pnpm run build:cloudflare
```

## Database

Auth and API migrations remain independent:

- Auth: `drizzle.config.ts` → `drizzle/`
- API: `drizzle.api.config.ts` → `drizzle-api/`

```bash
pnpm run db:generate
pnpm run db:migrate
pnpm run db:push       # local development only
pnpm run db:studio
```

Workers never auto-migrate. Use `pnpm db:migrate` against an explicit database, or set `RUN_STARTUP_TASKS=1` only on a deliberate Node admin process.

## Deployment

The console deploys to **Cloudflare Workers** (`pnpm run deploy` from `services/console` after review — never auto-deploy production from agents). Docker runs only the blob-server (Caddy + `static_s3`) and the Vector log pipeline:

```bash
# repository root
docker compose --env-file .env up -d      # blob-server, vector
docker compose --env-file .env ps
```

Useful console endpoints:

- Console: `http://localhost:3000`
- Health: `http://localhost:3000/api/health`
- Native API: `http://localhost:3000/api/*`
- Blob upload: `http://localhost:3000/api/deploy/blob`
- Usage ingest: `http://localhost:3000/internal/usage/ingest`
