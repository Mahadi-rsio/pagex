# Development Guide

This guide covers development setup, workflow, and best practices for the PageX monorepo.

## 🎯 Quick Start

### Option 1: Nix (Recommended)

Nix provides reproducible development environments with all dependencies pre-configured.

```bash
# Install Nix (if not already installed)
curl -L https://nixos.org/nix/install | sh

# Enable flakes
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Enter development environment
nix develop

# Or enter a service-specific shell
nix develop -c api        # API service
nix develop -c blob-server # Blob server
nix develop -c console     # Console service
```

### Option 2: Manual Setup

If you prefer not to use Nix, you can set up dependencies manually.

```bash
# Install Node.js 18+
nvm install 20
nvm use 20

# Install pnpm
npm install -g pnpm

# Install Go 1.20+
# Download from https://go.dev/dl/

# Install Docker
# Download from https://docs.docker.com/get-docker/

# Install PostgreSQL and Redis
# Or use Docker Compose (recommended)
```

## 🛠️ Development Workflow

### Install Dependencies

```bash
# Install all dependencies (root)
pnpm install

# Install dependencies for a specific service
cd services/api
pnpm install

# Or using filter
pnpm install --filter @pagex/api
```

### Start Development Servers

```bash
# Start API service
pnpm run dev:api

# Start console service
pnpm run dev:console

# Start blob server (requires Go)
cd services/blob-server
go run .
```

### Use Docker Compose for Full Stack

```bash
# Copy default environment
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

# View logs
docker compose logs -f

# Stop services
docker compose down
```

## 🏗️ Service Development

### API Service Development

```bash
# Enter API service directory
cd services/api

# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Run database migrations
pnpm run db:migrate

# Generate migrations after schema changes
pnpm run db:generate

# Push schema changes directly (development only)
pnpm run db:push

# Open Drizzle Studio
pnpm run db:studio
```

**Development URL:** http://localhost:3000

### Blob Server Development

```bash
# Enter blob server directory
cd services/blob-server

# Install Go dependencies
go mod download

# Start development server
go run .

# Or build and run
xcaddy build --with github.com/Mahadi-rsio/pagex/services/blob-server=. --output ./caddy
./caddy run --config Caddyfile

# Run tests
go test -v ./...
```

**Development URL:** http://localhost:80

### Console Development

```bash
# Enter console directory
cd services/console

# Install dependencies
pnpm install

# Start development server
pnpm run dev

# Run database migrations
pnpm run db:migrate

# Generate migrations
pnpm run db:generate
```

**Development URL:** http://localhost:3080

## 🔧 Nix Development

### Nix Flakes

This project uses Nix flakes for reproducible development environments.

```bash
# Show available flakes
nix flake show

# Build all outputs
nix build

# Build specific output
nix build .#api
nix build .#blob-server
nix build .#console

# Enter development shell
nix develop

# Enter service-specific shell
nix develop -c api
```

### Nix Shell Customization

Each service has its own `flake.nix` with service-specific dependencies:

- **API:** Node.js, PostgreSQL, Redis, Docker
- **Blob Server:** Go, Caddy, GCC
- **Console:** Node.js, PostgreSQL, Redis

### Adding New Dependencies with Nix

To add a new dependency to a service:

1. Edit the service's `flake.nix`
2. Add the package to `buildInputs`
3. Rebuild the development shell

Example for API service:

```nix
# services/api/flake.nix
devShells.default = pkgs.mkShell {
  buildInputs = with pkgs; [
    nodejs_20
    pnpm
    postgresql
    redis
    # Add new dependency here
    new-package
  ];
  # ...
};
```

## 🐳 Docker Development

### Docker Compose

The project uses Docker Compose for local development with all services.

```bash
# Start all services
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

# Start specific services
docker compose up -d api db redis

# View running containers
docker compose ps

# View logs
docker compose logs -f

# Stop all services
docker compose down

# Stop and remove volumes
docker compose down -v
```

### Docker Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Main development configuration |
| `docker-compose.dev.yml` | Development overrides (optional) |
| `docker-compose.prod.yml` | Production configuration (optional) |

### Building Docker Images

```bash
# Build API image
docker build -t pagex-api -f services/api/Dockerfile .

# Build blob-server image
docker build -t pagex-blob-server -f services/blob-server/Dockerfile .

# Build console image
docker build -t pagex-console -f services/console/Dockerfile .

# Build all images
docker compose build
```

### Docker Multi-stage Builds

Each service uses multi-stage Docker builds for optimized images:

1. **Builder stage:** Installs dependencies and compiles source
2. **Runtime stage:** Copies only necessary files for production

## 📦 Package Management

### pnpm Workspaces

This project uses pnpm workspaces for efficient dependency management.

```bash
# Install all dependencies
pnpm install

# Install dependencies for a specific workspace
pnpm install --filter @pagex/api

# Add a dependency to a workspace
pnpm add --filter @pagex/api express

# Remove a dependency
pnpm remove --filter @pagex/api express

# Update dependencies
pnpm update

# List all dependencies
pnpm list
```

### Workspace Structure

```
packages/
├── types/      # Shared TypeScript types
├── utils/      # Shared utility functions
└── config/     # Shared configuration management

services/
├── api/       # API service
├── blob-server/ # Blob server
└── console/    # Console service
```

### Adding a New Package

1. Create package directory: `mkdir packages/new-package`
2. Create `package.json` with workspace name: `@pagex/new-package`
3. Add to root `package.json` workspaces if needed
4. Install dependencies: `pnpm install --filter @pagex/new-package`

### Adding a New Service

1. Create service directory: `mkdir services/new-service`
2. Create `package.json` with service name
3. Create `flake.nix` for Nix development environment
4. Create `Dockerfile` for Docker builds
5. Add to root `package.json` workspaces
6. Update Docker Compose configuration

## 🚀 Build System

### Turbo Build

This project uses Turbo for optimized incremental builds.

```bash
# Build all packages
turbo run build

# Run dev servers
turbo run dev

# Run tests
turbo run test

# Run lint
turbo run lint

# Clean build cache
turbo run clean
```

### Turbo Configuration

The `turbo.json` file defines the build pipeline:

```json
{
  "pipeline": {
    "build": {
      "dependsOn": ["^build"],
      "outputs": ["dist/**", ".next/**"]
    },
    "dev": {
      "cache": false,
      "persistent": true
    }
  }
}
```

### Cache Management

Turbo caches build outputs for faster rebuilds:

```bash
# Enable caching (default)
turbo run build

# Disable caching for a task
turbo run build --no-cache

# Clean cache
turbo run clean
```

## 🔄 Hot Reloading

### API Service

The API service supports hot reloading in development:

```bash
pnpm run dev:api
```

Changes to `services/api/src/` will automatically restart the server.

### Console Service

The console service supports Next.js fast refresh:

```bash
pnpm run dev:console
```

Changes to components and pages will hot reload.

### Blob Server

The blob server requires manual restart for Go code changes:

```bash
# In one terminal
go run .

# In another terminal, watch for changes and restart
# (or use a file watcher like nodemon for Go)
```

## 🧪 Testing

### API Service Tests

```bash
cd services/api
pnpm run test
```

### Blob Server Tests

```bash
cd services/blob-server
go test -v ./...
```

### Console Tests

```bash
cd services/console
pnpm run test
```

### End-to-End Tests

```bash
# Run the test script
node test.js

# Or with specific token
CLOUDISY_TOKEN=your-token node test.js

# Skip build step
SKIP_BUILD=1 node test.js
```

## 📊 Database Management

### Migrations

This project uses Drizzle ORM for database migrations.

```bash
# Generate migrations after schema changes
pnpm run db:generate

# Apply pending migrations
pnpm run db:migrate

# Push schema directly (development only)
pnpm run db:push

# Open Drizzle Studio (GUI)
pnpm run db:studio
```

### Database Schema

Database schemas are defined in:
- **API Service:** `services/api/drizzle/schema.ts`
- **Console:** `services/console/drizzle/schema.ts`

### Multiple Databases

The project uses separate databases for different purposes:
- **Main Database:** API service data (sites, pages, deployments, etc.)
- **Console Database:** Better Auth data (users, sessions, etc.)

Both can use the same PostgreSQL instance with different schemas.

## 🔧 Configuration Management

### Environment Variables

Environment variables are loaded from multiple sources:

1. `.env` file in project root
2. Service-specific `.env` files
3. System environment variables
4. Docker Compose environment files

### Configuration Files

| File | Purpose |
|------|---------|
| `.env` | Default environment variables |
| `infrastructure/configs/.env` | Infrastructure defaults |
| `services/*/.env` | Service-specific overrides |

### Configuration Validation

Each service validates its configuration using Zod schemas:

```typescript
// services/api/src/config.ts
import { z } from 'zod';

const ConfigSchema = z.object({
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url(),
  // ...
});

type Config = z.infer<typeof ConfigSchema>;

function getConfig(): Config {
  return ConfigSchema.parse(process.env);
}
```

## 📁 File Structure Conventions

### API Service

```
services/api/
├── src/
│   ├── controllers/      # HTTP controllers
│   ├── services/        # Business logic
│   ├── infrastructure/  # External services (DB, cache, storage)
│   ├── queue/           # BullMQ queue and workers
│   ├── routes/          # Express routes
│   ├── middleware/      # Express middleware
│   ├── validators/      # Request validation
│   ├── utils/           # Utility functions
│   ├── constants/       # Constants
│   ├── types/           # TypeScript types
│   ├── app.ts           # Express app setup
│   └── server.ts        # Server entrypoint
├── drizzle/            # Database migrations
├── Dockerfile          # Docker configuration
├── flake.nix           # Nix configuration
└── package.json        # Package configuration
```

### Blob Server

```
services/blob-server/
├── src/
│   ├── cache/          # LRU cache implementation
│   ├── handler/        # HTTP handlers
│   ├── plugin/         # Caddy plugin
│   ├── analytics/      # Analytics middleware
│   └── storage/        # S3/MinIO clients
├── Caddyfile           # Caddy configuration
├── go.mod              # Go module
├── go.sum              # Go dependencies
├── Dockerfile          # Docker configuration
└── flake.nix           # Nix configuration
```

### Console Service

```
services/console/
├── src/
│   ├── app/            # Next.js App Router
│   ├── components/     # React components
│   ├── lib/            # Utility libraries
│   ├── modules/        # Feature modules
│   ├── db/             # Database
│   └── store/          # State management
├── public/            # Static assets
├── drizzle/           # Database migrations
├── Dockerfile          # Docker configuration
└── flake.nix           # Nix configuration
```

## 🎨 Code Style

### TypeScript

- Use strict TypeScript configuration
- Prefer interfaces over type aliases for object shapes
- Use `unknown` instead of `any` for untyped data
- Use Zod for runtime validation

### Go

- Follow Go conventions (camelCase, etc.)
- Use proper error handling
- Write comprehensive tests
- Use context for cancellation

### Naming Conventions

| Type | Convention | Example |
|------|------------|---------|
| Variables | camelCase | `userName` |
| Constants | UPPER_SNAKE_CASE | `MAX_FILE_SIZE` |
| Functions | camelCase | `getUserById` |
| Types | PascalCase | `User` |
| Interfaces | PascalCase | `UserInterface` |
| Files | kebab-case | `user-service.ts` |
| Directories | kebab-case | `user-service/` |

## 📝 Git Conventions

### Commit Messages

Use conventional commits format:

```
type(scope): subject

body

footer
```

Types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `revert`

Examples:
- `feat(api): add user authentication`
- `fix(blob-server): handle missing S3 credentials`
- `docs: update development guide`
- `chore: update dependencies`

### Branch Naming

| Type | Format | Example |
|------|--------|---------|
| Feature | `feat/description` | `feat/user-authentication` |
| Bug Fix | `fix/description` | `fix/s3-upload-error` |
| Documentation | `docs/description` | `docs/api-reference` |
| Refactor | `refactor/description` | `refactor/user-service` |
| Chore | `chore/description` | `chore/update-deps` |

### Pull Requests

- Use descriptive titles
- Include detailed description
- Reference related issues
- Include screenshots for UI changes
- Keep PRs focused and reviewable

## 🔍 Debugging

### API Service Debugging

```bash
# Enable debug logging
DEBUG=pagex:* pnpm run dev:api

# Or set in .env
DEBUG=pagex:*
```

### Blob Server Debugging

```bash
# Enable verbose logging
CADDY_DEBUG=true go run .

# Or set log level
CADDY_LOG_LEVEL=debug go run .
```

### Console Debugging

```bash
# Enable Next.js debug logging
NEXTJS_DEBUG=true pnpm run dev:console

# Or set in .env
NEXTJS_DEBUG=true
```

### Docker Debugging

```bash
# View container logs
docker compose logs -f api

# Enter running container
docker compose exec api sh

# View container processes
docker compose top

# View container stats
docker compose stats
```

## 📊 Performance Optimization

### API Service

- Use connection pooling for database connections
- Implement caching for frequent queries
- Use streaming for large responses
- Optimize database queries

### Blob Server

- Use LRU caching for path resolution
- Enable streaming for large files
- Use proper cache headers
- Optimize S3 requests

### Console Service

- Use Next.js static generation where possible
- Implement client-side caching
- Optimize images
- Use code splitting

## 🚨 Troubleshooting

### Common Issues

**Issue: Missing environment variables**

```bash
# Check loaded environment variables
node -e "console.log(process.env)"

# Or in Docker
docker compose exec api node -e "console.log(process.env)"
```

**Issue: Database connection failed**

```bash
# Check database health
docker compose exec db pg_isready -U postgres -d pagex

# Check database logs
docker compose logs db
```

**Issue: Redis connection failed**

```bash
# Check Redis health
docker compose exec redis redis-cli ping

# Check Redis logs
docker compose logs redis
```

**Issue: MinIO connection failed**

```bash
# Check MinIO health
curl -v http://localhost:9000/minio/health/live

# Check MinIO logs
docker compose logs minio  # If running in Compose
```

**Issue: Port already in use**

```bash
# Find process using port (Linux/macOS)
lsof -i :3000

# Kill process
kill -9 <PID>
```

### Nix Troubleshooting

**Issue: Nix command not found**

```bash
# Check Nix installation
which nix

# Reinstall Nix
curl -L https://nixos.org/nix/install | sh
```

**Issue: Flakes not enabled**

```bash
# Enable flakes
echo "experimental-features = nix-command flakes" >> ~/.config/nix/nix.conf

# Restart Nix daemon
nix-daemon --restart
```

**Issue: Nix build failed**

```bash
# Clean Nix store
nix-collect-garbage -d

# Retry build
nix build
```

## 📚 Learning Resources

### Nix

- [Nix Manual](https://nixos.org/manual/nix/stable/)
- [Nix Flakes](https://nixos.wiki/wiki/Flakes)
- [Nixpkgs](https://github.com/NixOS/nixpkgs)

### Docker

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose](https://docs.docker.com/compose/)
- [Multi-stage Builds](https://docs.docker.com/build/building/multi-stage/)

### TypeScript

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/)
- [TypeScript Deep Dive](https://basarat.gitbook.io/typescript/)

### Go

- [Go Documentation](https://go.dev/doc/)
- [Effective Go](https://go.dev/doc/effective_go)

### Next.js

- [Next.js Documentation](https://nextjs.org/docs)
- [App Router](https://nextjs.org/docs/app)

### Express

- [Express Documentation](https://expressjs.com/)
- [Express Guide](https://expressjs.com/en/starter/installing.html)

## 🤝 Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guidelines.

## 📄 License

This project is licensed under the MIT License.
