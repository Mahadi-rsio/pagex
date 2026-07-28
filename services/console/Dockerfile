FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM node:24-alpine AS export-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN mv src/app/api /tmp/api-backup && \
    mv src/proxy.ts /tmp/proxy.ts.bak && \
    BUILD_MODE=export npm run build && \
    mv /tmp/api-backup src/app/api && \
    mv /tmp/proxy.ts.bak src/proxy.ts

FROM node:24-alpine AS api-builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN BUILD_MODE=standalone npm run build

FROM node:24-alpine AS migrator
WORKDIR /app
RUN npm init -y && \
    npm install drizzle-kit@^0.31.10 drizzle-orm@^0.45.2 dotenv postgres --omit=optional && \
    find /app/node_modules -type f \( -name "*.ts" -not -name "*.d.ts" -o -name "*.js.map" -o -name "CHANGELOG*" -o -name "README*" -o -name "SECURITY*" \) -delete 2>/dev/null; \
    npm cache clean --force && \
    rm -f package.json package-lock.json
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
ENV CI=true
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PORT=3000 \
    HOSTNAME="0.0.0.0" \
    STATIC_SRC=/opt/static \
    STATIC_DEST=/shared/static

RUN apk add --no-cache su-exec && \
    addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs && \
    mkdir -p /opt/static /shared/static && \
    chown -R nextjs:nodejs /opt/static /shared/static

COPY --from=export-builder /app/out /opt/static
COPY --from=api-builder /app/public ./public
COPY --from=api-builder /app/.next/standalone ./
COPY --from=api-builder /app/.next/static ./.next/static
COPY --chmod=755 docker-entrypoint.sh /app/

EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

ENTRYPOINT ["/app/docker-entrypoint.sh"]
