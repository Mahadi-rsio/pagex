# PageX - Multi-Tenant Static Site Hosting Platform

A scalable pnpm monorepo for hosting multi-tenant static sites with content-addressed blob storage, deployment manifests, automatic compression/optimization, and instant CLI deployments.

---

## 📚 Complete Project Index & Directory Tree

PageX is organized as a modular pnpm workspace monorepo. Below is the complete index of every service, package, infrastructure component, script, and documentation file in the repository:

```
pagex/
├── .agents/                      # AI assistant skills & configurations
│   └── skills/                   # Specialized agent skills
├── docs/                         # Comprehensive system documentation
│   ├── SCHEMA.md                 # Database schema documentation
│   ├── API.md                    # REST API endpoints & contracts
│   ├── RULES.md                  # Development rules & guidelines
│   ├── WORKERS.md                # Deploy path & background retention reference
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
│   │   ├── Dockerfile            # Production Docker build
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
│   └── docker.sh                 # Docker Compose helper script
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
│  │   (Database)    │  (Cache/Locks)  │     (S3 Storage)    │    │
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
   cp .env.example .env
   # Edit .env and set BETTER_AUTH_SECRET + S3 credentials
   ```

2. **Start the Full Stack:**
   ```bash
   docker compose --env-file .env up -d
   ```

3. **Verify Containers & Access:**
   ```bash
   docker compose ps
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
| `pnpm docker:api` | Start database, redis, and API |
| `pnpm docker:console` | Start database, redis, console, and blob-server |

---

## ⚙️ Configuration Reference

Key environment variables in `.env`:

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | Runtime environment mode |
| `DATABASE_URL` | - | PostgreSQL connection string for console/Better Auth |
| `REDIS_URL` | `redis://redis:6379` | Redis connection URL for cache and deployment locks |
| `EXPRESS_URL` | `http://api:3000` | Internal Express API URL (used by Next.js proxy) |
| `MINIO_ENDPOINT_URL` | - | S3/MinIO endpoint URL (must include `http://` or `https://`) |
| `S3_ACCESS_KEY` | - | S3 storage access key |
| `S3_SECRET_KEY` | - | S3 storage secret key |
| `MINIO_BUCKET` | `pagex-blobs` | S3 bucket name for static asset blobs |
| `BASE_DOMAIN` | `localhost` | Base domain for multi-tenant subdomain routing |
| `BETTER_AUTH_SECRET` | - | Secret key for authentication (required, 32+ hex chars) |

---

## ✨ Features & Ease of Use

PageX is designed from the ground up for maximum ease of use, rapid deployment, and developer efficiency:

- **CLI-Only Deployments:** Deployments use `/api/deploy/prepare|presign|commit` with atomic manifest activation.
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
- [Deploy & GC Reference](docs/WORKERS.md)
- [Development Rules](docs/RULES.md)

---

## 📄 License

Licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
