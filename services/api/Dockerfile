FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM deps AS builder
COPY . .
RUN npm run build

FROM node:20-alpine AS migrator
WORKDIR /app
RUN npm init -y && \
    npm install drizzle-kit@^0.31.10 drizzle-orm@^0.45.2 dotenv pg --omit=optional && \
    find /app/node_modules -type f \( -name "*.ts" -not -name "*.d.ts" -o -name "*.js.map" -o -name "CHANGELOG*" -o -name "README*" -o -name "SECURITY*" \) -delete 2>/dev/null; \
    npm cache clean --force && \
    rm -f package.json package-lock.json
COPY drizzle.config.ts ./
COPY drizzle/ ./drizzle/
COPY infrastructure/ ./infrastructure/
CMD ["npx", "drizzle-kit", "migrate"]

FROM node:24-alpine AS build-worker
WORKDIR /app
RUN apk add --no-cache docker-cli wget git
COPY package.json ./
RUN npm install --omit=dev && \
    rm -rf /app/node_modules/@img/sharp-wasm32 /app/node_modules/@emnapi && \
    find /app/node_modules -type f \( -name "*.ts" -not -name "*.d.ts" -o -name "*.js.map" -o -name "CHANGELOG*" -o -name "README*" -o -name "SECURITY*" \) -delete 2>/dev/null; \
    npm cache clean --force; \
    rm -f /app/package-lock.json
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
USER pagex
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1
CMD ["node", "dist/server.js"]
