# Next.js Console (static UI + auth API)

Next.js 16 app with client-side UI (static export), Better Auth API, PostgreSQL, Redis, and Docker Compose. Caddy serves the static UI and reverse-proxies `/api/*` to the Node container.

## Architecture

| Piece | Role |
|-------|------|
| **Caddy** `:3000` | Serves exported HTML/`_next`/public from a shared volume; proxies `/api/*` |
| **app** | Dual-build image: static UI in `/opt/static` + Next standalone API on `:3000` |
| **migrator** | One-shot `drizzle-kit migrate` against Postgres before `app` starts |
| **PostgreSQL** | Auth / app data (Drizzle) |
| **Redis** | Health / cache |

UI pages are client components (SSG). Session checks run in the browser via `AuthGuard` / `authClient`. Only `/api/auth` and `/api/health` are dynamic.

## Environment

```bash
cp .env.example .env
```

Set secrets and OAuth/SMTP values. For Compose (Caddy on port 3000), defaults in `.env.example` use `http://localhost:3000`.

## Local development

```bash
pnpm install
pnpm run dev
```

Open `http://localhost:3000`.

### Database

```bash
pnpm run db:generate   # generate migrations
pnpm run db:migrate    # apply migrations
pnpm run db:push       # optional: push schema directly
pnpm run db:studio     # Drizzle Studio
```

## Docker Compose (recommended)

Builds the app image, starts Postgres + Redis + Caddy:

```bash
docker compose up --build -d
```

Caddy config is split:

- [`Caddyfile`](Caddyfile) — site on `:3000`, imports snippets + routes
- [`caddy/snippets.caddy`](caddy/snippets.caddy) — reusable `dynamic_ssg` / `static_page` snippets
- [`caddy/routes.caddy`](caddy/routes.caddy) — full parent/nested route map (`app_routes`)

Then:

| Check | Command / URL |
|-------|----------------|
| UI | http://localhost:3000 |
| Login | http://localhost:3000/login/ |
| Device | http://localhost:3000/device/ |
| Health | `curl -sS http://localhost:3000/api/health` |
| Status | `docker compose ps` |
| Logs | `docker compose logs -f caddy app` |
| Migrate only | `docker compose run --rm migrator` |

**Why the UI felt slow:** static HTML/assets are fast; auth was failing because Postgres had no tables (`relation "user" does not exist`). Every page waits on `authClient.useSession()` → `/api/auth/*`, which errored until migrations ran. The `migrator` service applies Drizzle migrations before `app` starts.

Stop:

```bash
docker compose down
```

## GHCR image

Images are published to GitHub Container Registry on version tags.

**Image:** `ghcr.io/mahadi-rsio/next-web`

### Publish a release

```bash
git tag v0.1.0
git push origin v0.1.0
```

That runs [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml), which builds and pushes:

- `ghcr.io/mahadi-rsio/next-web:0.1.0`
- `ghcr.io/mahadi-rsio/next-web:0.1`
- `ghcr.io/mahadi-rsio/next-web:0`
- `ghcr.io/mahadi-rsio/next-web:latest`

You can also run the workflow manually (**Actions → Build and push Docker image to GHCR → Run workflow**) and set a custom tag.

### Pull and run the published image

1. Make the package public, or log in:

```bash
echo $GITHUB_TOKEN | docker login ghcr.io -u USERNAME --password-stdin
```

2. Point this repo’s Compose at the registry image (replace `build:` with `image:`):

```yaml
services:
  app:
    image: ghcr.io/mahadi-rsio/next-web:latest
```

```bash
docker compose pull app
docker compose up -d
```

### Use the image in another Compose file

The GHCR image is the **`runner`** stage (API + static UI). Use `image:` only — do not set `build:`.

**Cloudisy:** full drop-in Compose + Caddy config lives in [`examples/cloudisy/`](examples/cloudisy/). It adds:

| Service | Role |
|---------|------|
| `next_web` | `ghcr.io/mahadi-rsio/next-web:latest` (API + syncs static into a volume) |
| `next_web_caddy` | `caddy:2-alpine` on **:3080** — serves UI from the volume; proxies `/api/*` to `next_web` |

Cloudisy’s express `app` stays on `:3000`; site Caddy (`cdx_s3`) is unchanged. Copy `examples/cloudisy/{Caddyfile,caddy}` → Cloudisy `config/next-web/`, merge the compose file, set `BETTER_AUTH_*` in `.env`, then:

```bash
docker compose pull next_web
docker compose up -d
```

Console: http://localhost:3080

Minimal snippet (any Compose stack that already has Postgres + Redis):

```yaml
services:
  next_web:
    image: ghcr.io/mahadi-rsio/next-web:latest
    env_file: .env
    environment:
      DATABASE_URL: ${NEXT_WEB_DATABASE_URL:-${DIRECT_DB}}
      REDIS_URL: redis://redis:6379
      BETTER_AUTH_URL: http://localhost:3080
      BETTER_AUTH_TRUSTED_ORIGINS: http://localhost:3080
    volumes:
      - next_web_static:/shared/static
    expose:
      - "3000"
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped

  next_web_caddy:
    image: caddy:2-alpine
    ports:
      - "3080:3000"
    volumes:
      - ./config/next-web/Caddyfile:/etc/caddy/Caddyfile:ro
      - ./config/next-web/caddy:/etc/caddy/caddy:ro
      - next_web_static:/srv
    depends_on:
      next_web:
        condition: service_healthy
    restart: unless-stopped

volumes:
  next_web_static:
```

Notes:

- Point `DATABASE_URL` / `REDIS_URL` at the Postgres/Redis **service names** in that Compose file (or an external Docker network).
- Copy required vars from [`.env.example`](.env.example) (`BETTER_AUTH_*`, OAuth, SMTP, etc.).
- Mount the same `next_web_static` volume on Caddy at `/srv` and on `next_web` at `/shared/static`.
- Caddy must `reverse_proxy` `/api/*` to **`next_web:3000`**, not Cloudisy’s express `app`.
- The **migrator** target is not published to GHCR. Apply schema before start (from this repo: `docker compose run --rm migrator` or `pnpm run db:migrate` against the same DB).
- Local tag instead of GHCR: `docker build -t next-web:local --target runner .` then `image: next-web:local`.

## Scripts

| Script | Description |
|--------|-------------|
| `pnpm run dev` | Next.js dev server |
| `pnpm run build` | Production build (`BUILD_MODE=standalone` by default) |
| `pnpm run start` | Start production Node server |
| `pnpm run db:generate` | Generate Drizzle migration |
| `pnpm run db:migrate` | Run migrations |
| `pnpm run db:push` | Push schema |
| `pnpm run db:studio` | Open Drizzle Studio |
| `pnpm run lint` | Format with Biome |

Build modes (used in the Dockerfile):

- `BUILD_MODE=export` — static UI → `out/`
- `BUILD_MODE=standalone` — Node API server
