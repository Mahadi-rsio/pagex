# Development Guide

This guide covers development setup, workflow, and best practices for the PageX monorepo.

## 🎯 Quick Start

Install dependencies locally, or use Docker Compose for the full stack.

```bash
# Node.js 18+ (nvm recommended)
nvm install 20
nvm use 20

# pnpm
npm install -g pnpm

# Go 1.20+ — https://go.dev/dl/

# Docker — https://docs.docker.com/get-docker/

# Install workspace dependencies
pnpm install
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
3. Create `Dockerfile` for Docker builds
4. Add the service path to `pnpm-workspace.yaml` if needed
5. Update Docker Compose configuration

## 🚀 Build System

Root scripts use **pnpm workspaces** (`pnpm -r`) to run tasks across packages.

```bash
# Build all packages and services
pnpm run build

# Run dev servers (packages with a dev script)
pnpm run dev

# Run tests where defined
pnpm run test

# Run linters where defined
pnpm run lint

# Build or test a single service
pnpm run build:api
pnpm run test:blob-server
```

Workspace packages build in dependency order when you run `pnpm -r build` from the repo root. Shared packages (`@pagex/types`, `@pagex/utils`, `@pagex/config`) compile with TypeScript before services that depend on them.

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
└── package.json        # Package scripts
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
└── package.json        # Package configuration
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

## 📚 Learning Resources

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
