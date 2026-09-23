# PageX — Infrastructure & Docker Reference

---

## Docker Compose Services

| Service | Container | Image/Stage | Role |
|---------|-----------|-------------|------|
| `api` | `api` | `services/api/Dockerfile` → `runner` | Express REST API (port 3000) |
| `blob-server` | `caddy` | `ghcr.io/mahadi-rsio/pagex/blob-server:latest` | Caddy + static_s3 (blob serving) + console proxy `:3080` |
| `console` | `web` | `services/console/Dockerfile` | Next.js Console App (port 3001) |
| `db` | `db` | `postgres:16-alpine` | PostgreSQL Database |
| `db-backup` | `db_backup` | `scripts/db-backup` | Periodic pg_dump to MinIO |
| `redis` | `redis` | `redis:7-alpine` | Cache + Deploy Locks + Analytics (port 6379) |

---

## Dockerfile Stages (`services/api/Dockerfile`)

```
FROM node:20-alpine AS deps      # npm install
FROM deps AS builder           # npm run build → dist/
FROM node:20-alpine AS runner    # API Express Server (default: dist/server.js)
```

---

## Service Dependencies (startup order)

```
db (healthy)    ──► api ──► blob-server
redis (healthy) ──┤
                  └► console
```

---

## Ports (host:container)

| Service | Port |
|---------|------|
| `api` | `3000:3000` |
| `console` | `3001:3001` (proxied on `:3080`) |
| `db` | `5432:5432` |
| `redis` | `6379:6379` |
| `blob-server` | `80`, `443`, `3080`, `2019` |

---

## Getting Started

```bash
docker compose --env-file .env up -d
```
