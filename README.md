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

```bash
# Copy default environment file
cp infrastructure/configs/.env .env

# Edit .env with your configuration
nano .env

# Create build workspace for cloud builds
mkdir -p /tmp/cloudisy-builds

# Start all services
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

# View running services
docker compose ps

# View logs
docker compose logs -f
```

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

# Run database migrations
pnpm run db:migrate

# Start with Docker Compose
docker compose up -d
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

### Start Services

```bash
# Start all services
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

# Start specific services
docker compose up -d api blob-server console db redis

# View running containers
docker compose ps

# View logs
docker compose logs -f

# Stop services
docker compose down
```

### Service Ports

| Service | Port | Description |
|---------|------|-------------|
| API | 3000 | Main Express API |
| Blob Server | 80, 443 | Caddy HTTP/HTTPS |
| Blob Server Console | 3080 | Console access |
| Console | 3000 | Next.js API |
| PostgreSQL | 5432 | Database |
| Redis | 6379 | Cache/Queue |
| PgBouncer | 6432 | Connection pooler |

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

Copy the default environment file and modify as needed:

```bash
cp infrastructure/configs/.env .env
nano .env
```

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
