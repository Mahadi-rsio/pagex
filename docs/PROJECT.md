# Cloudisy Server — Project Map

> **Purpose of this file:** Give an AI assistant a dense, token-efficient snapshot of the entire project so it can navigate and edit code accurately without needing to read every source file.

---

## What This Is

**Cloudisy** is a multi-tenant static-site hosting platform. Each user project ("page") is served as a subdomain (`project.cloudisy.com`) directly from MinIO object storage via a custom Caddy plugin. Zero per-tenant Caddy config changes are needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM, TypeScript compiled to `dist/`) |
| HTTP Framework | Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| Queue / Worker | BullMQ (backed by Redis) |
| Cache | Redis (ioredis) |
| Object Storage | MinIO (S3-compatible) |
| Auth | JOSE — remote JWKS from `https://auth.cloudisy.com/api/auth/jwks` |
| Build containers | Docker — `cloudisy-build-env:latest` image (pnpm pre-installed, 1 GB RAM limit) |
| Validation | Zod |
| Rate limiting | express-rate-limit + rate-limit-redis |

---

## Monorepo Layout

```
pagex/
├── src/                   # TypeScript source (compiled → dist/)
│   ├── app.ts             # Express app factory (rate-limit, JSON, routes)
│   ├── server.ts          # Entrypoint: creates app, ensures MinIO bucket, starts server
│   ├── dns-settings.ts    # Cloudflare DNS helper (unused in main flow)
│   ├── constants/
│   │   └── index.ts       # TOP_LEVEL_DOMAIN, RATE_LIMIT_*, SYNC_CRON_PATTERN, MAX_FILE_SIZE
│   ├── middleware/
│   │   └── auth.middleware.ts   # JWT verify via JWKS; sets req.id, req.name
│   ├── infrastructure/
│   │   ├── db/
│   │   │   ├── db.ts       # Drizzle client (postgres-js)
│   │   │   └── schema.ts   # All table definitions (5 tables)
│   │   ├── cache/
│   │   │   └── redis.ts    # ioredis client + BullMQ connection config
│   │   └── storage/
│   │       └── minio.ts    # MinIO client, SHARED_BUCKET, helpers:
│   │                       #   ensureBucket, deleteSiteObjects, copyFolder, deleteFolder
│   ├── controllers/
│   │   ├── page.controller.ts        # create, list, delete, usage
│   │   ├── upload.controller.ts      # multipart ZIP upload → BullMQ
│   │   ├── build.controller.ts       # trigger, status, list, SSE logs
│   │   └── deployment.controller.ts  # list deployments, rollback
│   ├── services/
│   │   ├── page.service.ts           # createPage, deletePage, getListPages, getPageUsage
│   │   ├── upload.service.ts         # processUpload (wraps executeDeploymentFlow)
│   │   ├── build.service.ts          # triggerCloudBuild, getBuildStatus, listBuilds
│   │   ├── deployment.service.ts     # executeDeploymentFlow, rollbackToDeployment, listDeployments
│   │   └── sync.service.ts           # flushes Redis counters → PostgreSQL
│   ├── queue/
│   │   ├── jobs/
│   │   │   ├── upload.job.ts   # UPLOAD_QUEUE + UploadJobData interface
│   │   │   ├── build.queue.ts  # CLOUDISY_CLOUD_BUILDS_QUEUE + CloudBuildJob interface
│   │   │   └── sync.job.ts     # SYNC_QUEUE + scheduler
│   │   └── workers/
│   │       ├── upload.worker.ts  # Processes upload jobs (extract zip → deploy)
│   │       ├── build.worker.ts   # Processes build jobs (clone → docker → deploy)
│   │       └── sync.worker.ts    # Cron: flushes Redis counters to PostgreSQL
│   ├── routes/
│   │   ├── index.ts           # Mounts all routers + /health
│   │   ├── page.routes.ts     # /api/pages/*
│   │   ├── upload.routes.ts   # /upload/* (multer middleware)
│   │   ├── build.routes.ts    # /api/builds/*
│   │   └── deployment.routes.ts # /api/deployments/*
│   ├── types/
│   │   └── index.d.ts         # Express augmentations (req.id, req.name)
│   ├── utils/
│   │   ├── pipeline.ts        # Unused pipeline helper
│   │   └── emptyBucket.ts     # One-off utility to empty a MinIO bucket
│   └── validators/
│       ├── page.validator.ts   # createPageSchema (project_name: string min 3)
│       └── build.validator.ts  # triggerBuildSchema (pageId, repoUrl, gitProvider, etc.)
├── drizzle/               # Migration SQL files (auto-generated, committed)
│   ├── 0000_powerful_switch.sql
│   ├── 0001_same_valeria_richards.sql
│   └── 0002_tough_madame_hydra.sql   ← adds deployments table
├── docker-compose.yml     # All services (see INFRASTRUCTURE.md)
├── Dockerfile             # Multi-stage: builder → runner, build-worker, build-env
├── drizzle.config.ts      # Points to src/infrastructure/db/schema.ts
├── package.json
├── tsconfig.json
├── test.js                # End-to-end test script (Node, no test runner)
├── README.md              # Human-facing docs
└── docs/                  # AI-optimized documentation (this folder)
    ├── PROJECT.md         ← you are here
    ├── ARCHITECTURE.md    ← data flow diagrams
    ├── API.md             ← all endpoints with request/response shapes
    ├── WORKERS.md         ← queue job data shapes + worker step-by-step logic
    ├── SCHEMA.md          ← full DB schema + Redis key reference
    ├── RULES.md           ← coding conventions & patterns used in this repo
    └── SKILL.md           ← how to perform common development tasks
```

---

## Entry Points (per process)

| Process | File | Started by |
|---------|------|-----------|
| API server | `dist/src/server.js` | `express_app` Docker service |
| Upload worker | `dist/src/queue/workers/upload.worker.js` | `upload_w` Docker service |
| Build worker | `dist/src/queue/workers/build.worker.js` | `build_w` Docker service |
| Sync worker | `dist/src/queue/workers/sync.worker.js` | `sync_w` Docker service |
| Migrations | `drizzle-kit migrate` | `drizzle_migrator` Docker service (one-shot) |

---

## Key Constants (`src/constants/index.ts`)

| Constant | Value | Usage |
|----------|-------|-------|
| `TOP_LEVEL_DOMAIN` | `'localhost'` | Domain suffix for new pages |
| `TEMP_ZIPS_DIR` | `'temp_zips'` | Multer upload destination |
| `MAX_FILE_SIZE` | `250 MB` | Multer upload limit |
| `RATE_LIMIT_WINDOW_MS` | 15 min | Rate limiter window |
| `RATE_LIMIT_MAX` | 100 | Requests per window |
| `SYNC_CRON_PATTERN` | `'0 */2 * * * *'` | Every 2 minutes |

---

## Authentication

Every protected endpoint uses `authMiddleware` (`src/middleware/auth.middleware.ts`):
- Expects `Authorization: Bearer <JWT>` header
- Verifies with JWKS at `https://auth.cloudisy.com/api/auth/jwks`
- Sets `req.id = payload.id` (tenant ID) and `req.name = payload.name` (tenant name)
- On failure: `401 { error: "Invalid or expired token" }`

---

## MinIO Storage Layout

```
cloudisy-sites/
  {site_id}/                     ← live files served by Caddy
    index.html
    assets/...

cloudisy-snapshots/
  {site_id}/
    v1/                          ← deployment snapshot (last 5 kept)
      index.html
      assets/...
    v2/
      ...
```

Bucket: `cloudisy-sites` (single bucket for both prefixes — `SHARED_BUCKET` env var)

---

## Redis Key Reference

| Key pattern | Type | TTL | Written by |
|------------|------|-----|-----------|
| `site:{subdomain}` | String (UUID) | 5 min | Caddy plugin |
| `requests:{domain}` | String (counter) | none | Caddy plugin |
| `bandwidth:{domain}` | String (counter) | none | Caddy plugin |
| `db_cache:{domain}` | JSON string | 15 min | page.service.ts |
| BullMQ internal keys | Hash/List | BullMQ managed | BullMQ |
