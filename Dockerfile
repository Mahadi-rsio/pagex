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

# ---- builder (compile TS) ----
FROM node:20-alpine AS builder
WORKDIR /app

# Reuse node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package*.json ./

COPY . .

RUN npm run build

# ---- runner (production only) ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

EXPOSE 3000

CMD ["node", "dist/src/server.js"]

# ---- build-worker (needs git + docker CLI to run cloud builds) ----
FROM node:20-alpine AS build-worker
WORKDIR /app

ENV NODE_ENV=production

RUN apk add --no-cache git docker-cli

COPY package*.json ./
RUN npm ci --omit=dev

# Copy compiled output
COPY --from=builder /app/dist ./dist

CMD ["node", "dist/src/queue/workers/build.worker.js"]

