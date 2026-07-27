# PageX API Service - Multi-stage Dockerfile

# ============================================================================
# Stage 1: Builder - Compile TypeScript
# ============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile

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

RUN pnpm run build

# ============================================================================
# Stage 2: Migrator - Database migrations
# ============================================================================
FROM node:20-alpine AS migrator

WORKDIR /app

RUN npm install -g pnpm

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile

COPY drizzle.config.ts ./
COPY drizzle/ ./drizzle/
COPY infrastructure/ ./infrastructure/

CMD ["npx", "drizzle-kit", "migrate"]

# ============================================================================
# Stage 3: Build Worker - Cloud builds
# ============================================================================
FROM node:20-alpine AS build-worker

WORKDIR /app

RUN apk add --no-cache docker-cli wget

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle ./drizzle

CMD ["node", "dist/queue/workers/build.worker.js"]

# ============================================================================
# Stage 4: Build Environment - For cloud builds
# ============================================================================
FROM node:20-alpine AS build-env

WORKDIR /app

RUN npm install -g pnpm && apk add --no-cache git docker-cli

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --no-frozen-lockfile

CMD ["sh", "-c", "echo 'pagex-build-env ready'"]

# ============================================================================
# Stage 5: Runner - Production API / sync worker
# ============================================================================
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache wget && \
    addgroup -S pagex && adduser -S pagex -G pagex

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/package.json ./
COPY --from=builder /app/drizzle ./drizzle

USER pagex

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server.js"]
