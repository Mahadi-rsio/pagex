# PageX Console

The PageX console is a Next.js 16 monolith that serves the browser UI, Better Auth, and the native hosting API from one Node.js process.

## Architecture

| Piece | Role |
|-------|------|
| Caddy `:3080` | Reverse-proxies the console to `console:3001` and serves tenant sites with `static_s3` |
| Console `:3001` | Next.js UI, Better Auth, and native API |
| PostgreSQL | Auth and API data through separate Drizzle migration histories |
| Redis | Sessions, caches, rate limits, deploy tokens, and locks |
| MinIO | Blob-direct deployment storage and immutable manifests |
| Vector | Aggregates Caddy access logs and posts usage to the console |

Public `/api/*` requests enter through `src/app/api/[...path]/route.ts`. The native dispatcher performs JWT/JWKS authentication, rate limiting, Zod validation, and service dispatch. `/internal/usage/ingest` uses `USAGE_INGEST_TOKEN` instead.

## Local Development

From the repository root:

```bash
pnpm install
cp .env.example .env
pnpm dev:console
```

Next.js defaults to `http://localhost:3000`. When Caddy fronts the application, open `http://localhost:3080`.

Run these checks from `services/console`:

```bash
pnpm run test
pnpm run lint
pnpm exec tsc --noEmit
pnpm run build
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

`src/instrumentation.ts` applies both histories on Node.js server startup. The API bootstrap is compatible with databases originally created with `drizzle-kit push`.

## Docker

From the repository root:

```bash
docker compose --env-file .env up -d --build console
docker compose --env-file .env ps
docker compose --env-file .env logs -f web
```

Useful endpoints:

- Console: `http://localhost:3080`
- Health: `http://localhost:3080/api/health`
- Native API: `http://localhost:3080/api/*`
- Usage ingest: `http://localhost:3080/internal/usage/ingest`

Stop the stack with `docker compose --env-file .env down`.

## Images

Release images are published under `ghcr.io/mahadi-rsio/pagex/console`. Production Compose uses:

```text
ghcr.io/mahadi-rsio/pagex/console:${PAGEX_VERSION:-latest}
```

The separate API image is no longer published or deployed.
