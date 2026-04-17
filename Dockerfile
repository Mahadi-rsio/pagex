# ---- deps (install with dev deps for building) ----
FROM node:20-alpine AS deps
WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- builder (compile TS) ----
FROM node:20-alpine AS builder
WORKDIR /app

RUN corepack enable

# reuse node_modules with dev deps from deps stage
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/pnpm-lock.yaml ./pnpm-lock.yaml

COPY . .

RUN pnpm run build

# ---- runner (prod deps only) ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
RUN corepack enable

COPY package.json pnpm-lock.yaml ./
# install ONLY production dependencies (no dev deps)
RUN pnpm install --frozen-lockfile --prod

# only bring compiled output (and anything else you runtime-require)
COPY --from=builder /app/dist ./dist

EXPOSE 3000
CMD ["node", "dist/src/server.js"]
