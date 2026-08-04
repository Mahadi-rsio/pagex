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
| `DATABASE_URL` | - | PostgreSQL connection string (used by console service) |
| `NEXT_WEB_DATABASE_URL` | - | PostgreSQL connection string for console DB (maps to `DATABASE_URL` inside container) |
| `REDIS_URL` | redis://redis:6379 | Redis connection URL (use `redis` hostname in Docker Compose) |
| `EXPRESS_URL` | http://api:3000 | Internal URL of the Express API — used by the Next.js `/api/proxy/*` route. Use `http://api:3000` in Docker Compose, `http://localhost:3000` for local dev |
| `AUTH_JWKS_URL` | http://console:3001/api/auth/jwks | JWKS endpoint for JWT verification. Must point to console service port **3001** |
| `MINIO_ENDPOINT_URL` | - | MinIO endpoint URL — **must include scheme (http:// or https://)** |
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

## 🎯 Key Benefits

### Multi-Tenancy at Scale
- **Isolated Sites**: Each tenant gets their own subdomain with complete isolation
- **Shared Infrastructure**: All tenants share the same blob storage, reducing costs
- **Zero Per-Tenant Config**: No Caddy configuration changes needed for new sites
- **Instant Provisioning**: New sites are ready immediately after database entry

### Performance Optimizations
- **Content-Addressed Storage**: Files are stored by SHA256 hash, enabling automatic deduplication
- **Pre-Compressed Variants**: Automatic Brotli and Gzip compression for all assets
- **WebP Optimization**: Automatic WebP conversion for supported images
- **Edge Caching**: Browser cache headers optimized by file type
- **Memory-Efficient Streaming**: Files stream directly from S3 to client without loading into memory

### Developer Experience
- **Instant Deployments**: Deploy changes in seconds, not minutes
- **Automatic Rollbacks**: One-click rollback to any previous deployment
- **Real-time Preview**: See changes before they go live
- **Git-Based Workflow**: Connect your repository for automatic deployments
- **Custom Domains**: Support for custom domains with automatic SSL

### Cost Efficiency
- **Blob Deduplication**: Same file uploaded by multiple sites stores only once
- **Bandwidth Optimization**: Optional S3 redirect saves VPS bandwidth
- **Resource Sharing**: PostgreSQL, Redis, and MinIO shared across all tenants
- **No Cold Starts**: Static sites are always ready at full speed

## ⚡ Speed & Performance

### Architecture Optimizations

#### 1. Content-Addressed Blob Storage
```
Traditional:  tenant-a/uploads/image.png  (stored separately per tenant)
PageX:       blobs/a1b2c3d4...  (SHA256 hash, shared across tenants)
```
- **Deduplication**: Identical files from different sites share the same blob
- **Cache Efficiency**: Same blob can be cached once for all sites
- **Integrity**: SHA256 hash ensures file integrity

#### 2. Multi-Level Caching Strategy

```
┌─────────────────────────────────────────────────────────────┐
│                      Caching Layers                              │
├─────────────────────────────────────────────────────────────┤
│  Level 1: Browser Cache (Cache-Control headers)                │
│    - HTML: no-cache (always revalidate)                         │
│    - JS/CSS: max-age=31536000, immutable                        │
│    - Images: max-age=604800                                    │
│    - Other: max-age=3600                                       │
├─────────────────────────────────────────────────────────────┤
│  Level 2: Caddy LRU Memory Cache                               │
│    - Path resolution: {subdomain}:{version}:{path}:{enc}     │
│    - File content: Up to 512KiB per file (configurable)       │
│    - Negative cache: 404 responses cached for 1 minute       │
│    - Version-scoped: Old entries become unreachable on deploy  │
├─────────────────────────────────────────────────────────────┤
│  Level 3: Redis Path Map Cache                                 │
│    - site_files:{site_id} → Hash map of path → blob_hash      │
│    - TTL: 24 hours (rebuilt from PostgreSQL on miss)            │
│    - Contains all file variants (.br, .gz, .webp)               │
└─────────────────────────────────────────────────────────────┘
```

#### 3. Compression Pipeline
```
Original File (e.g., main.js - 500KB)
    │
    ├───► Brotli Compression (main.js.br - ~150KB)
    │       └───► Served to browsers supporting br
    │
    ├───► Gzip Compression (main.js.gz - ~200KB)
    │       └───► Served to browsers supporting gzip
    │
    └───► Original (main.js - 500KB)
            └───► Served to browsers with no compression support

Image Files (e.g., hero.png - 200KB)
    │
    └───► WebP Conversion (hero.webp - ~80KB)
            └───► Served to browsers supporting WebP
```

#### 4. Request Flow Optimization
```
Client Request → Caddy (Blob Server)
    │
    ├───► Check LRU Cache (path resolution) ───► HIT → Skip Redis → MinIO
    │
    ├───► Check Negative Cache ───────────────► HIT → Return 404
    │
    ├───► Check Redis site_files ────────────► HIT → Get blob hash
    │                                           MISS → PostgreSQL fallback
    │
    └───► MinIO GetObject (streaming)
            ├───► Cache body in LRU (if < max_cache_size)
            └───► Stream to client
```

### Performance Metrics

| Metric | Value | Notes |
|--------|-------|-------|
| First Byte Time | < 50ms | From LRU cache |
| Full Page Load | < 200ms | Cached, compressed |
| Uncached Request | < 500ms | Redis + MinIO |
| Deploy Time | < 5s | File upload + Redis rebuild |
| Blob Deduplication | 100% | Identical files stored once |
| Bandwidth Savings | 60-80% | Brotli + Gzip compression |

## 💾 Caching Deep Dive

### Cache Invalidation Strategy

#### Version-Based Invalidation
Instead of clearing all caches on deploy, PageX uses **version bumping**:

```
Deploy 1:
  site_version:6daea731... = "1"
  Cache keys: "fff:1:/:br", "fff:1/index.html:raw:body"

Deploy 2:
  site_version:6daea731... = "2"  (incremented by backend)
  Cache keys: "fff:2:/:br", "fff:2/index.html:raw:body"
  
Old cache entries (version 1) become unreachable and naturally expire
```

**Benefits:**
- Zero downtime during deploy
- No cache stampede
- Old entries evict naturally via LRU/TTL
- Instant rollback by reverting version

#### Cache Key Structure

```
# Path Resolution Cache
{subdomain}:{version}:{path}:{encoding}
Example: "myapp:5:/about:br"

# Body Content Cache  
{subdomain}:{version}:{path}:{encoding}:body
Example: "myapp:5:/about:br:body"

# Negative Cache (404)
{subdomain}:{version}:{path}:404
Example: "myapp:5:/nonexistent:404"

# Version Cache
{subdomain}:__version__
Example: "myapp:__version__"
```

### Cache Configuration Options

| Option | Default | Recommended Production | Description |
|--------|---------|----------------------|-------------|
| `cache_ttl` | 0 (disabled) | 10m | TTL for cache entries |
| `cache_size` | 1000 | 10000 | Max LRU entries |
| `max_cache_size` | 512KiB | 1MB-5MB | Max file size to cache body |
| `REDIRECT_TO_S3` | false | true | Redirect to S3 for bandwidth savings |
| `PRESIGN_REDIRECT` | false | true (if bucket private) | Pre-signed URLs for private buckets |

### Redis Cache Strategy

```
# Site Lookup (5 minute TTL)
GET site:{subdomain} → site_id

# Site Version (permanent)
GET site_version:{site_id} → version_number

# File Path Map (24 hour TTL, rebuilt from PG on miss)
HGETALL site_files:{site_id} → {path: blob_hash, ...}

# Fallback: PostgreSQL Query
SELECT path, blob_hash FROM blob_tree_entries 
  JOIN deployments ON ... 
  WHERE is_active AND site_id = $1
```

## 🚀 Complete Usage Guide

### Quick Start (Docker Compose)

#### 1. Clone and Configure

```bash
# Clone the repository
git clone https://github.com/Mahadi-rsio/pagex.git
cd pagex

# Copy the Docker Compose env file
cp infrastructure/configs/.env infrastructure/configs/.env.backup

# Edit the configuration
nano infrastructure/configs/.env
```

#### 2. Required Configuration

Edit `infrastructure/configs/.env` and set these **minimum required** values:

```bash
# Generate a strong secret (32+ characters)
BETTER_AUTH_SECRET=$(openssl rand -hex 32)

# Or use Node.js:
BETTER_AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")

# Set your base domain
BASE_DOMAIN=yourdomain.com  # or 'localhost' for local dev

# Configure your storage (example for MinIO)
MINIO_ENDPOINT=your-minio-server.com
MINIO_ENDPOINT_URL=https://your-minio-server.com  # MUST include https://
S3_ACCESS_KEY=your-access-key
S3_SECRET_KEY=your-secret-key
MINIO_BUCKET=your-bucket-name
```

#### 3. Start the Stack

```bash
# Method 1: Using pnpm (recommended)
pnpm docker:up

# Method 2: Using the helper script
./scripts/docker.sh up

# Method 3: Raw docker compose
docker compose \
  --env-file infrastructure/configs/.env \
  -f infrastructure/docker/compose/docker-compose.yml \
  up -d
```

#### 4. Verify Installation

```bash
# Check all containers are running
pnpm docker:ps

# View logs
pnpm docker:logs

# Test the console
curl -I http://localhost:3080

# Test the API
curl -I http://localhost:3000/api/health
```

### Deploying Your First Site

#### Using the Console UI

1. Open http://localhost:3080 in your browser
2. Register an account (if email auth is enabled)
3. Create a new project
4. Follow the deployment instructions

#### Using the CLI

```bash
# Install the CLI (from the cli directory)
# Then deploy a site

# Create a project
cli project create my-site --subdomain my-site

# Deploy files
cli deploy my-site ./my-static-site/
```

### Production Deployment

#### Recommended Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Production Setup                         │
├─────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐      │
│  │   Load      │    │   Caddy     │    │   PageX     │      │
│  │  Balancer   │───►│  (Blob      │───►│   Services   │      │
│  │             │    │   Server)   │    │             │      │
│  └─────────────┘    └─────────────┘    └─────────────┘      │
│         │                   │                    │              │
│         └───────────────────┴────────────────────┘              │
│                                                                  │
│  ┌─────────────────────────────────────────────────────┐   │
│  │                    External Services                      │   │
│  ├─────────────┬─────────────┬─────────────┬────────────┐│   │
│  │  PostgreSQL  │    Redis     │   MinIO     │  SMTP      ││   │
│  │  (Managed)   │  (Managed)   │  (S3-compat) │  (SendGrid)││   │
│  └─────────────┴─────────────┴─────────────┴────────────┘│   │
│                                                                  │
└─────────────────────────────────────────────────────────────┘
```

#### Production Configuration Example

```bash
# infrastructure/configs/.env for Production

# Database (Managed PostgreSQL)
DB=postgresql://pagex:strong-password@db.your-vps.com:5432/pagex
DIRECT_DB=postgresql://pagex:strong-password@db.your-vps.com:5432/pagex

# Redis (Managed)
REDIS_URL=redis://:password@redis.your-vps.com:6379/0

# MinIO / S3 (for blob storage)
S3_ACCESS_KEY=your-s3-access-key
S3_SECRET_KEY=your-s3-secret-key
MINIO_ENDPOINT=s3.your-provider.com
MINIO_ENDPOINT_URL=https://s3.your-provider.com
MINIO_PORT=443
MINIO_USE_SSL=true
MINIO_BUCKET=pagex-prod-blobs

# Application
NODE_ENV=production
IN_DOCKER_COMPOSE=1
PUBLIC_URL=https://console.yourdomain.com
BASE_DOMAIN=yourdomain.com

# Authentication
BETTER_AUTH_SECRET=your-generated-strong-secret-here
BETTER_AUTH_URL=https://console.yourdomain.com
BETTER_AUTH_TRUSTED_ORIGINS=https://console.yourdomain.com,https://yourdomain.com
AUTH_JWKS_URL=http://console:3000/api/auth/jwks

# Performance (recommended for production)
REDIRECT_TO_S3=true
PRESIGN_REDIRECT=true
PRESIGN_LIFETIME=15m
CACHE_TTL=10m
CACHE_SIZE=10000
MAX_CACHE_SIZE=1MB

# Email (optional)
ENABLE_EMAIL_PASSWORD=true
NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD=true
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=your-sendgrid-api-key
SENDER=noreply@yourdomain.com
```

#### SSL/TLS Configuration

1. Place your SSL certificates in `infrastructure/certs/`:
   - `cert.pem` - Your SSL certificate
   - `key.pem` - Your private key

2. The Caddyfile is already configured to use these certificates

3. For Let's Encrypt (not recommended for wildcard domains):
   ```bash
   # In infrastructure/configs/config/Caddyfile, change:
   auto_https off  # to: auto_https on
   ```

#### Domain Configuration

1. Point your DNS to your server IP:
   ```
   *.yourdomain.com  A  123.123.123.123
   console.yourdomain.com  A  123.123.123.123
   api.yourdomain.com  A  123.123.123.123
   ```

2. Set `BASE_DOMAIN=yourdomain.com` in your `.env`

3. Restart the stack:
   ```bash
   pnpm docker:down
   pnpm docker:up
   ```

### Monitoring & Maintenance

#### Check System Health

```bash
# Check all services
pnpm docker:ps

# View logs for specific service
pnpm docker:logs -- api

# Check database connection
pnpm docker:exec -- api psql -U postgres -c "SELECT count(*) FROM sites;"

# Check Redis
pnpm docker:exec -- redis redis-cli PING
```

#### Backup Strategy

```bash
# Backup PostgreSQL
pg_dump -U postgres -h localhost pagex > pagex_backup_$(date +%Y%m%d).sql

# Backup Redis
redis-cli SAVE

# Backup MinIO bucket
mc mirror minio/pagex-blobs backup/pagex-blobs-$(date +%Y%m%d)/
```

#### Cleanup Old Deployments

```bash
# List deployments
pnpm docker:exec -- api psql -U postgres -c \
  "SELECT s.subdomain, COUNT(d.*) as deploy_count \
   FROM sites s LEFT JOIN deployments d ON s.id = d.site_id \
   GROUP BY s.subdomain;"

# Cleanup old blobs (run periodically)
pnpm docker:exec -- api node -e "
  require('./scripts/cleanup-blobs').run({ days: 30 });
"
```

### Troubleshooting

#### Common Issues

| Issue | Solution |
|-------|----------|
| 404 on deployed site | Check `MINIO_ENDPOINT_URL` has `https://` scheme |
| Session expired errors | Verify `BETTER_AUTH_TRUSTED_ORIGINS` includes your domain |
| Database connection failed | Check `DB` connection string uses Docker hostname `db` |
| Redis connection failed | Check `REDIS_URL` uses Docker hostname `redis` |
| Blob upload failed | Verify MinIO credentials and bucket exists |

#### Debug Commands

```bash
# Test MinIO connection from API container
docker exec pagex_api node -e "
  const Minio = require('minio');
  const client = new Minio.Client({
    endPoint: process.env.MINIO_ENDPOINT,
    port: parseInt(process.env.MINIO_PORT),
    useSSL: process.env.MINIO_USE_SSL === 'true',
    accessKey: process.env.S3_ACCESS_KEY,
    secretKey: process.env.S3_SECRET_KEY
  });
  client.bucketExists(process.env.MINIO_BUCKET, (err, exists) => {
    console.log('Bucket exists:', exists);
    if (err) console.error('Error:', err);
  });
"

# Test Redis connection
docker exec pagex_api node -e "
  const redis = require('redis');
  const client = redis.createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => console.error('Redis error:', err));
  client.on('connect', () => console.log('Redis connected'));
"

# Test PostgreSQL connection
docker exec pagex_api psql -U postgres -c "SELECT 1 as test;"
```

## 📊 Performance Tuning

### Optimize for High Traffic

```bash
# In infrastructure/configs/.env

# Enable S3 redirect to save bandwidth
REDIRECT_TO_S3=true
PRESIGN_REDIRECT=true

# Increase cache sizes for production
CACHE_TTL=30m
CACHE_SIZE=50000
MAX_CACHE_SIZE=5MB

# Use connection pooling
# (Already configured in docker-compose.yml via PgBouncer)
```

### Optimize for Development

```bash
# In infrastructure/configs/.env

# Disable S3 redirect for local testing
REDIRECT_TO_S3=false

# Short cache TTL for rapid development
CACHE_TTL=1m
CACHE_SIZE=1000
MAX_CACHE_SIZE=512KiB
```

### Monitor Performance

```bash
# Check Caddy metrics
curl http://localhost:2019/metrics

# Check memory usage
docker stats pagex_blob_server pagex_api pagex_console

# Check response times
pnpm docker:logs -- blob-server | grep "duration="
```

## 🔐 Security Best Practices

### Required
- [ ] Generate strong `BETTER_AUTH_SECRET` (32+ hex characters)
- [ ] Use HTTPS in production (configure certificates)
- [ ] Set `MINIO_ENDPOINT_URL` with proper scheme
- [ ] Use strong database passwords
- [ ] Restrict `BETTER_AUTH_TRUSTED_ORIGINS` to your domains

### Recommended
- [ ] Use managed database services (Supabase, AWS RDS, etc.)
- [ ] Use managed Redis (Redis Labs, AWS ElastiCache)
- [ ] Use S3-compatible storage with proper access controls
- [ ] Enable `PRESIGN_REDIRECT` for private buckets
- [ ] Rotate secrets regularly
- [ ] Use Docker secrets for sensitive data in production

### OAuth Security
- Register separate OAuth apps for development and production
- Use different callback URLs for each environment
- Store client secrets securely (never commit to git)
- Consider using OAuth PKCE for enhanced security

## 🎓 Use Cases

### Static Site Hosting
Perfect for:
- Portfolio websites
- Marketing landing pages
- Documentation sites
- Blogs (with static site generators)

Supported frameworks:
- Next.js (static export)
- Astro
- Gatsby
- Hugo
- Jekyll
- VuePress
- SvelteKit (static adapter)
- Any static HTML/CSS/JS

### Multi-Tenant SaaS
- White-label solutions
- Agency websites
- Microsite platforms
- Campaign landing pages

### High-Performance Applications
- Content delivery networks
- Asset hosting
- API documentation
- Design system previews

## 📚 Additional Resources

- [Caddy Documentation](https://caddyserver.com/docs/)
- [Better Auth Documentation](https://better-auth.com/docs)
- [MinIO Documentation](https://min.io/docs/minio/linux/index.html)
- [Drizzle ORM](https://orm.drizzle.team/docs)
- [Next.js Documentation](https://nextjs.org/docs)

## 🤝 Support

- **Issues**: [GitHub Issues](https://github.com/Mahadi-rsio/pagex/issues)
- **Discussions**: [GitHub Discussions](https://github.com/Mahadi-rsio/pagex/discussions)
- **Contributing**: See [CONTRIBUTING.md](CONTRIBUTING.md)

---

**Built with ❤️ for developers who want simple, fast, and scalable static site hosting.**

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
