# ---- deps (install with dev deps for building) ----
FROM node:20-alpine AS deps
WORKDIR /app

COPY package*.json ./
RUN npm install

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
