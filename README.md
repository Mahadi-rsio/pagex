# PageX - Multi-tenant Static Site Hosting Platform

A scalable, Nix-based monorepo for hosting multi-tenant static sites with content-addressed blob storage, automatic optimization, and instant deployments.

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         PageX Platform                              │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐      │
│  │   Console     │    │  Blob Server  │    │     API      │      │
│  │  (Next.js)    │    │  (Caddy)      │    │  (Express)   │      │
│  └──────┬───────┘    └──────┬───────┘    └──────┬───────┘      │
│         │                  │                  │                │
│         └──────────┬───────┘                  │                │
│                    │                          │                │
│         ┌──────────▼───────┐                  │                │
│         │    Caddy          │◄─────────────────┘                │
│         │  (Reverse Proxy)   │                                    │
│         └──────────┬───────┘                                    │
│                    │                                             │
│         ┌──────────▼───────┐                                    │
│         │    Client         │                                    │
│         │  (Browser)        │                                    │
│         └──────────────────┘                                    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    Shared Infrastructure                    │   │
│  ├─────────────────┬─────────────────┬─────────────────┐    │   │
│  │  PostgreSQL      │    Redis         │    MinIO         │    │   │
│  │  (Database)      │  (Cache/Queue)   │  (Storage)        │    │   │
│  └─────────────────┴─────────────────┴─────────────────┘    │   │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 📁 Project Structure

```
pagex/
├── services/                    # Core services
│   ├── api/                    # Main Express backend
│   │   ├── src/                # TypeScript source
│   │   ├── Dockerfile          # Multi-stage Docker build
│   │   └── flake.nix           # Nix development environment
│   │
│   ├── blob-server/           # Caddy with static_s3 plugin
│   │   ├── src/                # Go source
│   │   ├── Dockerfile          # Docker build
│   │   └── flake.nix           # Nix development environment
│   │
│   └── console/               # Next.js web console
│       ├── src/                # Next.js source
│       ├── Dockerfile          # Multi-stage Docker build
│       └── flake.nix           # Nix development environment
│
├── packages/                   # Shared packages
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   └── config/                # Configuration management
│
├── infrastructure/             # Infrastructure as code
│   ├── docker/                # Docker configurations
│   │   └── compose/           # Docker Compose files
│   ├── kubernetes/            # Kubernetes manifests (future)
│   ├── configs/               # Configuration files
│   │   ├── caddy/             # Caddy configurations
│   │   ├── databases/         # Database configurations
│   │   └── .env              # Default environment variables
│   └── certs/                # SSL certificates
│
├── scripts/                   # Global scripts
│   ├── docker.sh              # Docker Compose helper (env + compose paths)
│   ├── migrations/            # Database migrations
│   └── setup/                 # Setup scripts
│
├── docs/                      # Documentation
│   ├── architecture.md        # System architecture
│   ├── services/             # Service documentation
│   └── development.md         # Development guide
│
├── flake.nix                  # Root Nix flake
├── flake.lock                 # Nix flake lock file
├── package.json               # Root package.json (pnpm workspaces)
├── turbo.json                 # Turbo build configuration
└── README.md                  # This file
```

## 🚀 Getting Started

### Prerequisites

- [Nix](https://nixos.org/download.html) (recommended for reproducible development)
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose
- [pnpm](https://pnpm.io/installation) (optional, but recommended)
- [Node.js](https://nodejs.org/) 18+ (if not using Nix)
- [Go](https://go.dev/dl/) 1.20+ (if not using Nix)

### Quick Start with Nix

```bash
# Enter development environment (automatically installs all dependencies)
nix develop

# Or enter a service-specific shell
nix develop -c api        # API service
nix develop -c blob-server # Blob server
nix develop -c console     # Console service
```

### Quick Start with Docker

Compose always loads `infrastructure/configs/.env` (uses Docker service hostnames like `db`, not `localhost`). Edit that file for stack configuration.

```bash
# Ensure Docker env exists (repo ships a default under infrastructure/configs/)
# Edit infrastructure/configs/.env as needed — set BETTER_AUTH_SECRET at minimum

# Create build workspace for cloud builds (if using build workers)
mkdir -p /tmp/cloudisy-builds

# Start the full stack
pnpm docker:up

# Or use the helper script directly
./scripts/docker.sh up

# Check status / logs
pnpm docker:ps
pnpm docker:logs
```

Console UI is served via the blob server on **http://localhost:3080**. The API is on **http://localhost:3000**.

### Development Workflow

```bash
# Install dependencies (using pnpm)
pnpm install

# Start API service in development mode
pnpm run dev:api

# Start console in development mode
pnpm run dev:console

# Build all services
pnpm run build

# Run database migrations (local / API)
pnpm run db:migrate

# Start with Docker Compose
pnpm docker:up
```

## 🛠️ Development with Nix

### Enter Development Environment

```bash
# Full development environment with all tools
nix develop

# Service-specific environments
nix develop -c api        # API service with Node.js, PostgreSQL, Redis
nix develop -c blob-server # Blob server with Go, Caddy
nix develop -c console     # Console with Node.js, Next.js
```

### Build with Nix

```bash
# Build all services
nix build

# Build specific service
nix build .#api
nix build .#blob-server
nix build .#console

# Run service directly
nix run .#api
```

### Build Docker Images with Nix

```bash
# Build API Docker image
docker build -t pagex-api -f services/api/Dockerfile .

# Build blob-server Docker image
docker build -t pagex-blob-server -f services/blob-server/Dockerfile .

# Build console Docker image
docker build -t pagex-console -f services/console/Dockerfile .
```

## 🐳 Docker Compose

Use the helper script or `pnpm docker:*` scripts. Both always pass `--env-file infrastructure/configs/.env` so Compose interpolation uses Docker network hostnames.

### pnpm scripts

| Script | What it does |
|--------|----------------|
| `pnpm docker:up` | Start all services (`-d`) |
| `pnpm docker:down` | Stop and remove containers |
| `pnpm docker:build` | Build images |
| `pnpm docker:rebuild` | `--no-cache` build, then up |
| `pnpm docker:restart` | Restart services |
| `pnpm docker:ps` | List containers |
| `pnpm docker:logs` | Follow logs |
| `pnpm docker:exec` | Shell into a service (`pnpm docker:exec -- console`) |
| `pnpm docker:migrate` | Run API + console migrators |
| `pnpm docker:console` | Start DB/Redis + migrators + console + blob-server |
| `pnpm docker:api` | Start DB/Redis/PgBouncer + migrator + API |
| `pnpm docker:workers` | Start workers profile (sync/build) |
| `pnpm docker:config` | Validate compose config |
| `pnpm docker -- <cmd>` | Pass-through to `scripts/docker.sh` |

### Common commands

```bash
# Full stack
pnpm docker:up

# Console only (with deps + auth migrator)
pnpm docker:console

# API only (with deps + API migrator)
pnpm docker:api

# Rebuild and restart console after code changes
pnpm docker:rebuild -- console console-migrator

# Follow one service
pnpm docker:logs -- console

# Run migrations only
pnpm docker:migrate

# Stop everything
pnpm docker:down
```

Equivalent via the script:

```bash
./scripts/docker.sh up
./scripts/docker.sh up api console db redis
./scripts/docker.sh logs console
./scripts/docker.sh rebuild console console-migrator
./scripts/docker.sh migrate
./scripts/docker.sh down
```

Raw `docker compose` (if you prefer not to use the helper):

```bash
docker compose \
  --env-file infrastructure/configs/.env \
  -f infrastructure/docker/compose/docker-compose.yml \
  up -d
```

### Migrators

| Service | Image target | Purpose |
|---------|--------------|---------|
| `migrator` | `services/api` → `migrator` | API / platform schema |
| `console-migrator` | `services/console` → `migrator` | Better Auth / console schema |

`console` waits for `console-migrator` to finish successfully; `api` waits for `migrator`.

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| API | 3000 | Main Express API |
| Blob Server | 80, 443 | Caddy HTTP/HTTPS |
| Console (via blob server) | 3080 | Public console UI |
| Console (direct) | 3001 | Next.js app (API + pages) |
| Console (internal) | 3000 | Next.js inside the Docker network |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache/Queue |
| PgBouncer | 6432 | Connection pooler |

### Environment notes

- **Docker stack:** edit `infrastructure/configs/.env` (hosts like `db`, `redis`).
- **Local tooling outside Compose:** a root `.env` may use `localhost` — do not point Compose interpolation at it or containers will fail to reach Postgres/Redis.
- `BETTER_AUTH_SECRET` is required for the console service.

## 📦 Package Management

### pnpm Workspaces

This project uses [pnpm workspaces](https://pnpm.io/workspaces) for efficient dependency management.

```bash
# Install all dependencies
pnpm install

# Install dependencies for a specific package
pnpm install --filter @pagex/api
pnpm install --filter @pagex/types

# Add a dependency to a package
pnpm add --filter @pagex/api express

# Update dependencies
pnpm update
```

### Turbo Build

This project uses [Turbo](https://turbo.build/) for optimized builds.

```bash
# Build all packages
turbo run build

# Run dev servers
turbo run dev

# Run tests
turbo run test

# Run lint
turbo run lint
```

## 🏗️ Services

### API Service

The main Express backend that handles:
- Site management (create, delete, list)
- Deployment management (prepare, presign, commit, rollback)
- Build management (trigger, status, logs)
- Analytics and usage tracking

**Location:** `services/api/`

**Commands:**
```bash
pnpm run dev        # Start development server
pnpm run build      # Build for production
pnpm run lint       # Run linter
pnpm run test       # Run tests
pnpm run db:migrate # Run database migrations
```

### Blob Server

Caddy web server with custom `static_s3` plugin for:
- Multi-tenant blob-direct serving
- Content-addressed blob storage
- Automatic compression variants (Brotli, Gzip)
- Image optimization (WebP)
- High-performance caching
- S3-compatible storage (MinIO, AWS S3, Cloudflare R2, etc.)

**Location:** `services/blob-server/`

**Commands:**
```bash
go run .              # Start development server
xcaddy build          # Build Caddy with plugin
go test -v ./...      # Run tests
```

### Console

Next.js web interface for:
- User authentication (Better Auth)
- Project management
- Deployment management
- Build management
- Analytics dashboard

**Location:** `services/console/`

**Commands:**
```bash
pnpm run dev        # Start development server
pnpm run build      # Build for production
pnpm run lint       # Run linter
pnpm run db:migrate # Run database migrations
```

## 🔧 Configuration

### Environment Variables

For Docker Compose, edit the Docker-oriented env file:

```bash
nano infrastructure/configs/.env
```

For local (non-Compose) development you may also keep a root `.env` with `localhost` hosts. Do not use the root `.env` for Compose interpolation.

### Key Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Node.js environment |
| `DATABASE_URL` | - | PostgreSQL connection string |
| `REDIS_URL` | redis://localhost:6379 | Redis connection URL |
| `MINIO_ENDPOINT_URL` | - | MinIO endpoint URL |
| `S3_ACCESS_KEY` | - | S3/MinIO access key |
| `S3_SECRET_KEY` | - | S3/MinIO secret key |
| `MINIO_BUCKET` | pagex-blobs | Blob storage bucket |
| `BASE_DOMAIN` | localhost | Base domain for subdomain routing |
| `PUBLIC_URL` | http://localhost:3080 | Public console URL |
| `BETTER_AUTH_SECRET` | - | Better Auth secret (required) |

### Service-Specific Configuration

Each service has its own configuration:
- **API:** `services/api/` - Express server configuration
- **Blob Server:** `services/blob-server/` - Caddy and plugin configuration
- **Console:** `services/console/` - Next.js and Better Auth configuration

## 📄 Documentation

- [Architecture](docs/architecture.md) - System architecture overview
- [Development Guide](docs/development.md) - Development setup and workflow
- [API Service](docs/services/api.md) - API service documentation
- [Blob Server](docs/services/blob-server.md) - Blob server documentation
- [Console](docs/services/console.md) - Console documentation

## 🤖 AI Development

For AI assistants working on this codebase:
- Use `nix develop` for reproducible development environments
- Each service has its own `flake.nix` for service-specific dependencies
- Shared packages are in `packages/` directory
- Use `pnpm` for package management
- Use `turbo` for optimized builds

## 📝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🤝 Community

- [GitHub Issues](https://github.com/Mahadi-rsio/pagex/issues) - Report issues and feature requests
- [Discussions](https://github.com/Mahadi-rsio/pagex/discussions) - Ask questions and discuss ideas

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
