# Cloudisy multi-stage Dockerfile
#
# Stages:
#   build-env     → cloudisy-build-env:latest (pnpm base for cloud builds)
#   deps          → npm install (shared)
#   migrator      → one-shot drizzle-kit migrate
#   builder       → tsc → dist/
#   runner        → Express API + sync worker (production deps)
#   build-worker  → cloud build queue worker (git + docker CLI)
#
# No upload worker — deploys are CLI prepare/presign/commit or cloud build → blobs.

# ---- build-env (reusable image for cloud build jobs — pnpm pre-installed) ----
FROM node:20-alpine AS build-env
RUN npm install -g pnpm --silent

# ---- deps (install with dev deps for building) ----
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm install

# ---- migrator (one-shot drizzle-kit migrate) ----
FROM deps AS migrator
WORKDIR /app

COPY drizzle.config.ts ./
COPY drizzle ./drizzle

CMD ["npx", "drizzle-kit", "migrate"]

# ---- builder (compile TypeScript → dist/) ----
FROM node:20-alpine AS builder
WORKDIR /app

# Reuse node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

COPY . .

RUN npm run build

# ---- runner (API server + sync worker) ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Compiled output (API, sync worker, deploy/scripts)
COPY --from=builder /app/dist ./dist

EXPOSE 3000

# Default: Express API. Override command for sync_worker in compose.
CMD ["node", "dist/src/server.js"]

# ---- build-worker (git + docker CLI for cloud builds) ----
FROM node:20-alpine AS build-worker
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache git docker-cli

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

CMD ["node", "dist/src/queue/workers/build.worker.js"]
