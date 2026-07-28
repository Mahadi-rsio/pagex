FROM node:24-alpine AS base
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm,target=/root/.local/share/pnpm/store \
    pnpm config set store-dir /root/.local/share/pnpm/store && \
    pnpm config set package-import-method copy && \
    pnpm install --no-frozen-lockfile --ignore-scripts

# --- Static UI export (no API routes / proxy) ---
FROM base AS export-builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Route handlers and proxy are unsupported with output: "export"
RUN mv src/app/api /tmp/api-backup && \
    mv src/proxy.ts /tmp/proxy.ts.bak && \
    BUILD_MODE=export npm run build && \
    mv /tmp/api-backup src/app/api && \
    mv /tmp/proxy.ts.bak src/proxy.ts

# --- Standalone API server ---
FROM base AS api-builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN BUILD_MODE=standalone npm run build

# --- DB migrator (drizzle-kit) ---
FROM deps AS migrator
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml drizzle.config.ts ./
COPY drizzle ./drizzle
ENV CI=true
CMD ["pnpm", "exec", "drizzle-kit", "migrate"]

FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV STATIC_SRC=/opt/static
ENV STATIC_DEST=/shared/static

RUN apk add --no-cache su-exec wget && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /opt/static /shared/static && \
    chown -R nextjs:nodejs /opt/static /shared/static

COPY --from=export-builder --chown=nextjs:nodejs /app/out /opt/static
COPY --from=api-builder /app/public ./public
COPY --from=api-builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=api-builder --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --chmod=755 docker-entrypoint.sh /app/docker-entrypoint.sh

# Entrypoint runs as root to sync the shared volume, then drops to nextjs.
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
