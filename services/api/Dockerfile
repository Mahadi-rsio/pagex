FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:24-alpine AS build-worker
WORKDIR /app
RUN apk add --no-cache docker-cli wget git && \
    addgroup -g 10001 appuser && adduser -u 10001 -G appuser -D appuser
COPY package.json ./
RUN npm install --omit=dev && \
    rm -rf /app/node_modules/@img/sharp-wasm32 /app/node_modules/@emnapi && \
    find /app/node_modules -type f \( -name "*.ts" -not -name "*.d.ts" -o -name "*.js.map" -o -name "CHANGELOG*" -o -name "README*" -o -name "SECURITY*" \) -delete 2>/dev/null; \
    npm cache clean --force; \
    rm -f /app/package-lock.json
# The worker runs as UID 10001 — the SAME uid that every tenant build container
# runs as (--user 10001:10001). Cloned repos it writes to the shared
# build-shared volume are therefore owned by 10001, so the non-root build
# container can actually write to its /app bind-mount.
USER 10001
# Shared volume root owned by the run user so the worker can create clones.
RUN mkdir -p /tmp/cloudisy-builds
COPY --from=builder /app/dist ./dist
CMD ["node", "dist/queue/workers/build.worker.js"]

FROM node:24-alpine AS build-env
WORKDIR /app
RUN apk add --no-cache git docker-cli && \
    corepack enable && \
    corepack prepare pnpm@8.15.0 --activate && \
    pnpm --version
COPY package.json ./
RUN npm install
CMD ["sh", "-c", "echo 'pagex-build-env ready'"]

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache wget && \
    addgroup -S pagex && adduser -S pagex -G pagex
COPY package.json ./
RUN npm install --omit=dev && \
    rm -rf /app/node_modules/@img/sharp-wasm32 /app/node_modules/@emnapi && \
    find /app/node_modules -type f \( -name "*.ts" -not -name "*.d.ts" -o -name "*.js.map" -o -name "CHANGELOG*" -o -name "README*" -o -name "SECURITY*" \) -delete 2>/dev/null; \
    npm cache clean --force; \
    rm -f /app/package-lock.json
COPY --from=builder /app/dist ./dist
# Migrations are run at startup via drizzle-orm migrate()
COPY --from=builder /app/drizzle ./drizzle
USER pagex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
