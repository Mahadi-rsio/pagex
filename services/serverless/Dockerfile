FROM node:20-alpine AS deps
WORKDIR /app
COPY package.json ./
RUN npm install

FROM deps AS builder
COPY . .
RUN npm run build

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
