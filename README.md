# PageX - Multi-Tenant Static Site Hosting Platform

A scalable pnpm monorepo for hosting multi-tenant static sites with content-addressed blob storage, deployment manifests, automatic compression/optimization, and instant deployments.

---

## 📚 Complete Project Index & Directory Tree

PageX is organized as a modular pnpm workspace monorepo. Below is the complete index of every service, package, infrastructure component, script, and documentation file in the repository:

```
pagex/
├── .agents/                      # AI assistant skills & configurations
│   └── skills/                   # Specialized agent skills (caveman, review, commit, etc.)
├── docs/                         # Comprehensive system documentation
│   ├── SCHEMA.md                 # Database schema documentation
│   ├── API.md                    # REST API endpoints & contracts
│   ├── RULES.md                  # Development rules & guidelines
│   ├── WORKERS.md                # Background worker architecture
│   ├── development.md            # Local development guide
│   ├── INFRASTRUCTURE.md         # Infrastructure & deployment guide
│   ├── PROJECT.md                # Project overview & roadmap
│   ├── SKILL.md                  # Agent skill definitions
│   └── architecture.md           # System architecture deep dive
├── infrastructure/               # Infrastructure as Code (IaC) & Configs
│   ├── certs/                    # SSL/TLS certificates (cert.pem, key.pem)
│   ├── configs/                  # Service & infrastructure configuration files
│   │   ├── .env                  # Docker Compose environment template
│   │   ├── caddy/                # Caddy server configurations
│   │   ├── databases/            # Database initialization scripts
│   │   └── config/               # Caddyfiles, migrator Dockerfiles, Drizzle configs
│   └── docker/                   # Docker setups
│       └── compose/              # Docker Compose multi-service stacks (docker-compose.yml)
├── packages/                     # Shared monorepo packages (reusable libraries)
│   ├── config/                   # Shared configuration management & schemas (@pagex/config)
│   ├── types/                    # Shared TypeScript interfaces & API contracts (@pagex/types)
│   └── utils/                    # Shared utility functions (validation, crypto, file, logging) (@pagex/utils)
├── services/                     # Core independent microservices
│   ├── api/                      # Main Express backend REST API (@pagex/api)
│   │   ├── src/                  # TypeScript source code (site/deployment management, auth)
│   │   ├── Dockerfile            # Multi-stage production Docker build & migrator target
│   │   └── package.json          # API service dependencies & scripts
│   ├── blob-server/              # High-performance Caddy server with static_s3 plugin (@pagex/blob-server)
│   │   ├── src/                  # Go source code for custom Caddy static_s3 plugin & cache engine
│   │   ├── Dockerfile            # Go + Caddy multi-stage builder Dockerfile
│   │   ├── Caddyfile             # Caddy routing, caching, and compression rules
│   │   └── package.json          # Package management for blob-server
│   └── console/                  # Next.js web dashboard & console app (@pagex/console)
│       ├── src/                  # Next.js App Router source (auth, projects, storage, settings)
│       │   ├── app/              # App router pages, API routes, and proxy handlers
│       │   ├── components/       # UI components (shadcn/ui library, console views, skeletons)
│       │   ├── db/               # Drizzle ORM schema & client definitions
│       │   ├── lib/              # API client, mappers, deployment utilities
│       │   ├── modules/          # Authentication module (Better Auth integration)
│       │   └── store/            # Zustand state stores
│       ├── Dockerfile            # Next.js production Docker build
│       ├── Dockerfile.migrator   # Database migrator Dockerfile for Better Auth / console DB
│       └── package.json          # Console dependencies & scripts
├── scripts/                      # Global orchestration scripts
│   └── docker.sh                 # Robust Docker Compose wrapper (env validation, service shortcuts)
├── .env                          # Local environment variables template
├── .env.example                  # Environment variables example file
├── Caddyfile                     # Root Caddy reverse proxy configuration
├── package.json                  # Root package.json defining pnpm workspaces & scripts
└── pnpm-workspace.yaml           # pnpm workspace package globs
```

---

## 🏗️ Architecture & Data Flow

PageX combines a Next.js control panel, an Express management API, a custom Caddy blob-serving plugin in Go, and shared infrastructure (PostgreSQL, Redis, MinIO/S3).

```
┌─────────────────────────────────────────────────────────────────┐
│                         PageX Platform                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐       │
│  │   Console    │    │ Blob Server  │    │     API      │       │
│  │  (Next.js)   │    │   (Caddy)    │    │  (Express)   │       │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘       │
│         │                  │                  │                 │
│         └──────────┬───────┘                  │                 │
│                    │                          │                 │
│         ┌──────────▼───────┐                  │                 │
│         │     Caddy        │◄─────────────────┘                 │
│         │ (Reverse Proxy)  │                                    │
│         └──────────┬───────┘                                    │
│                    │                                            │
│         ┌──────────▼───────┐                                    │
│         │     Client       │                                    │
│         │    (Browser)     │                                    │
│         └──────────────────┘                                    │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                  Shared Infrastructure                  │    │
│  ├─────────────────┬─────────────────┬─────────────────────┤    │
│  │   PostgreSQL    │      Redis      │        MinIO        │    │
│  │   (Database)    │  (Cache/Queue)  │     (S3 Storage)    │    │
│  └─────────────────┴─────────────────┴─────────────────────┘    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Getting Started & Prerequisites

### Prerequisites
- **Docker & Docker Compose** — for the full local stack (recommended)
- **pnpm** (v8+) — monorepo package manager
- **Node.js** (v18+) — API and console development
- **Go** (v1.20+) — blob-server (Caddy plugin) development

---

## 🐳 Quick Start: Docker Compose

1. **Configure Environment:**
   ```bash
   cp infrastructure/configs/.env infrastructure/configs/.env.backup
   # Edit infrastructure/configs/.env and set BETTER_AUTH_SECRET + S3 credentials
   ```

2. **Start the Full Stack:**
   ```bash
   # Using pnpm script helper
   pnpm docker:up

   # Or using the docker helper script directly
   ./scripts/docker.sh up
   ```

3. **Verify Containers & Access:**
   ```bash
   pnpm docker:ps
   ```
   - **Console UI:** http://localhost:3080
   - **API Service:** http://localhost:3000
   - **PostgreSQL:** localhost:5432
   - **Redis:** localhost:6379

---

## 🛠️ Local Development

```bash
# Install all monorepo dependencies
pnpm install

# Start individual services
pnpm run dev:api
pnpm run dev:console
pnpm run dev:blob-server

# Build all workspace packages and services
pnpm run build

# Run tests and linters
pnpm run test
pnpm run lint

# Database migrations (API)
pnpm run db:migrate
```

---

## 📋 Comprehensive pnpm & Docker Script Reference

### Root `package.json` Scripts

| Script | Action |
|---|---|
| `pnpm install` | Install all workspace dependencies |
| `pnpm build` | Build all workspace packages and services |
| `pnpm test` | Run tests in packages that define a `test` script |
| `pnpm dev:api` | Start the Express API in development mode |
| `pnpm dev:console` | Start the Next.js Console in development mode |
| `pnpm db:migrate` | Execute database migrations across services |
| `pnpm lint` | Run code linters across the monorepo |

### Docker Compose Helper Commands (`pnpm docker:*`)

| Command | Description |
|---|---|
| `pnpm docker:up` | Start all services in detached mode (`-d`) |
| `pnpm docker:down` | Stop and remove all Docker containers |
| `pnpm docker:build` | Build container images |
| `pnpm docker:rebuild` | Perform a clean `--no-cache` rebuild and start |
| `pnpm docker:restart` | Restart all containers |
| `pnpm docker:ps` | List running containers and status |
| `pnpm docker:logs` | Stream container logs |
| `pnpm docker:migrate` | Run API and console database migrators |
| `pnpm docker:api` | Start database, redis, migrator, and API |
| `pnpm docker:console` | Start database, redis, migrator, console, and blob-server |

---

## ⚙️ Configuration Reference

Key environment variables in `infrastructure/configs/.env`:

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment mode |
| `DATABASE_URL` | - | PostgreSQL connection string for console/Better Auth |
| `REDIS_URL` | `redis://redis:6379` | Redis cache and queue connection URL |
| `EXPRESS_URL` | `http://api:3000` | Internal Express API URL (used by Next.js proxy) |
| `MINIO_ENDPOINT_URL` | - | S3/MinIO endpoint URL (must include `http://` or `https://`) |
| `S3_ACCESS_KEY` | - | S3 storage access key |
| `S3_SECRET_KEY` | - | S3 storage secret key |
| `MINIO_BUCKET` | `pagex-blobs` | S3 bucket name for static asset blobs |
| `BASE_DOMAIN` | `localhost` | Base domain for multi-tenant subdomain routing |
| `BETTER_AUTH_SECRET` | - | Secret key for authentication (required, 32+ hex chars) |

### 🔴 Strictly Required Environment Variables

These variables MUST be set in `infrastructure/configs/.env` (for Docker) or `.env` (for local dev) before launching:

1. **`BETTER_AUTH_SECRET`**: Secret key used for session signing and auth token encryption (minimum 32 hex chars).
   - Generate via: `openssl rand -hex 32`
2. **`BASE_DOMAIN`**: Base domain for multi-tenant subdomain resolution (`localhost` for local dev, `yourdomain.com` for production).
3. **`DB` / `NEXT_WEB_DATABASE_URL`**: PostgreSQL connection URL (`postgresql://postgres:postgres@db:5432/pagex`).
4. **`REDIS_URL`**: Redis connection string for background jobs and LRU cache backing (`redis://redis:6379`).
5. **`S3_ACCESS_KEY` & `S3_SECRET_KEY`**: Credentials for MinIO/S3 object storage.
6. **`MINIO_ENDPOINT_URL`**: Full URL to MinIO/S3 API including scheme (`http://minio:9000` or `https://s3.amazonaws.com`).
7. **`MINIO_BUCKET`**: Bucket name for deployment blobs (`pagex-blobs`).

### ⚪ Optional Environment Variables

- **OAuth Authentication:** `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (For social logins).
- **Direct S3 Downloads:** `REDIRECT_TO_S3=true`, `PRESIGN_REDIRECT=true`, `PRESIGN_LIFETIME=15m` (Redirects client requests directly to S3/MinIO signed URLs to save server bandwidth).
- **Email Notifications:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SENDER` (For transactional password resets and emails).

---

## ✨ Features & Ease of Use

PageX is designed from the ground up for maximum ease of use, rapid deployment, and developer efficiency:

- **Zero-Config One-Command Setup:** Bring up the entire microservices stack (Next.js Console, Express API, Caddy Blob Server, PostgreSQL, Redis, MinIO S3) with a single command: `pnpm docker:up`.
- **Manifest-Based Runtime Serving:** Finalized deployments get an immutable MinIO manifest; Caddy resolves `path → blob hash` from L1 memory / Redis / MinIO without querying `blob_tree_entries` per request.
- **Content-Addressed & Instant Deployment:** Submitting a deployment uploads static blobs to MinIO with instant atomic site updates handled by Caddy edge proxying.
- **pnpm Workspace Monorepo:** Shared TypeScript types (`@pagex/types`), utilities (`@pagex/utils`), and config (`@pagex/config`) with per-service scripts at the root.

---

## 📄 Documentation Index

For detailed guides, refer to the files inside `docs/`:
- [Architecture Overview](docs/architecture.md)
- [Development Guide](docs/development.md)
- [Database Schema](docs/SCHEMA.md)
- [API Endpoints & Contracts](docs/API.md)
- [Infrastructure & Deployment](docs/INFRASTRUCTURE.md)
- [Background Workers](docs/WORKERS.md)
- [Development Rules](docs/RULES.md)

---

## 📄 License

Licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
