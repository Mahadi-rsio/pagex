# PageX API Service - Multi-stage Dockerfile
# Supports Nix for reproducible builds

# ============================================================================
# Stage 1: Build Environment (Nix-based)
# ============================================================================
FROM nixos/nix:latest AS nix-builder

WORKDIR /app

# Copy all files
COPY . .

# Install dependencies using Nix (fallback to pnpm if Nix fails)
RUN if command -v nix-shell &> /dev/null; then \
      echo "Building with Nix..." && \
      nix-shell --run "pnpm install --frozen-lockfile && pnpm run build" || \
      (echo "Nix build failed, falling back to pnpm..." && \
       npm install -g pnpm && \
       pnpm install --frozen-lockfile && \
       pnpm run build); \
    else \
      echo "Nix not available, using pnpm directly..." && \
      npm install -g pnpm && \
      pnpm install --frozen-lockfile && \
      pnpm run build; \
    fi

# ============================================================================
# Stage 2: Builder - Compile TypeScript
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

     # Install dependencies
     RUN pnpm install --no-frozen-lockfile

     # Copy source files
     COPY *.ts ./
     COPY constants/ ./constants/
     COPY controllers/ ./controllers/
     COPY middleware/ ./middleware/
     COPY queue/ ./queue/
     COPY routes/ ./routes/
     COPY services/ ./services/
     COPY types/ ./types/
     COPY utils/ ./utils/
     COPY validators/ ./validators/
     COPY infrastructure/ ./infrastructure/
     COPY drizzle/ ./drizzle/
     COPY tsconfig.json ./

     # Build TypeScript
     RUN pnpm run build

# ============================================================================
# Stage 3: Migrator - Database migrations
# ============================================================================
FROM node:20-alpine AS migrator

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies including drizzle-kit
RUN pnpm install --no-frozen-lockfile

# Copy drizzle config and migrations
COPY drizzle.config.ts ./
COPY drizzle/ ./drizzle/
COPY infrastructure/ ./infrastructure/

# Set entrypoint
CMD ["npx", "drizzle-kit", "migrate"]

# ============================================================================
# Stage 4: Build Worker - Cloud builds
# ============================================================================
FROM node:20-alpine AS build-worker

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile --production

# Copy source files
COPY src/ ./src/
COPY dist/ ./dist/
COPY drizzle/ ./drizzle/
COPY tsconfig.json ./

# Install Docker CLI for DinD
RUN apk add --no-cache docker-cli

# Set entrypoint
CMD ["node", "dist/src/queue/workers/build.worker.js"]

# ============================================================================
# Stage 5: Build Environment - For cloud builds
# ============================================================================
FROM node:20-alpine AS build-env

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Install build dependencies
RUN apk add --no-cache git docker-cli

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --no-frozen-lockfile

# Set entrypoint
CMD ["sh", "-c", "echo 'cloudisy-build-env ready'"]

# ============================================================================
# Stage 6: Runner - Production runtime
# ============================================================================
FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN npm install -g pnpm

# Copy from builder
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./

# Copy drizzle for migrations
COPY --from=builder /app/drizzle ./drizzle

# Create non-root user
RUN addgroup -S pagex && adduser -S pagex -G pagex
USER pagex

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Set entrypoint
CMD ["node", "dist/server.js"]
