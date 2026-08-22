# Cloudisy Server — Project Map

> **Purpose of this file:** Give an AI assistant a dense, token-efficient snapshot of the entire project so it can navigate and edit code accurately without needing to read every source file.

---

## What This Is

**Cloudisy** is a multi-tenant static-site hosting platform. Each user project ("page") is served as a subdomain (`project.cloudisy.com`) from content-addressed MinIO blobs via a custom Caddy plugin and deployment manifests. Zero per-tenant Caddy config changes are needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM, TypeScript compiled to `dist/`) |
| HTTP Framework | Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| Queue / Worker | BullMQ (backed by Redis DB2) |
| Cache | Redis (ioredis) — DB0 site/active_deployment/manifest, DB3 tokens/usage |
| Object Storage | MinIO (S3-compatible) — external |
| Auth | JOSE — JWKS from next-web (`AUTH_JWKS_URL`) |
| Build containers | Docker — `cloudisy-build-env:latest` (pnpm, 1 GB RAM) |
| Image / compress | `sharp` (WebP), Node `zlib` (Brotli/Gzip) |
| Validation | Zod + `file-type` magic bytes |
| Rate limiting | express-rate-limit + rate-limit-redis |
| Concurrency | `p-limit` (blob I/O + GC deletes, concurrency 10) |

---

## Monorepo Layout

```
pagex/
├── src/
│   ├── app.ts / server.ts
│   ├── constants/index.ts          # DEPLOYMENT_RETENTION=10, MANIFEST_REDIS_TTL_SECONDS, COMMIT_TIMEOUT, …
│   ├── middleware/auth.middleware.ts
│   ├── infrastructure/
│   │   ├── db/db.ts, schema.ts     # sites, pages, stats, builds, deployments, blobs, blob_tree_entries
│   │   ├── cache/redis.ts          # redis (DB0), usageRedis (DB3), BullMQ connection (DB2)
│   │   └── storage/minio.ts        # blobObjectKey, objectMetaForPath, deleteBlobObjects
│   ├── controllers/                # page, deploy, build, deployment
│   ├── services/
│   │   ├── deploy.service.ts       # prepare / presign / commitBlobTreeDeploy / manifest / variants
│   │   ├── deployment-lock.service.ts # per-page Redis deploy:lock:{pageId}
│   │   ├── deployment.service.ts   # listDeployments, rollbackToDeployment
│   │   ├── gc.service.ts           # runDeploymentGC (fire-and-forget)
│   │   ├── build.service.ts
│   │   └── page.service.ts
│   ├── queue/
│   │   ├── jobs/build.queue.ts
│   │   └── workers/build.worker.ts
│   ├── routes/                     # page, deploy, build, deployment (+ /health)
│   ├── scripts/migrate-to-blob-serving.ts
│   ├── utils/
│   │   ├── deployment-validator.ts # ≤100 files, ≤10 MB, blocked extensions
│   │   ├── file-validator.ts       # magic bytes + EXT_ALIASES (svg↔xml)
│   │   └── http-error.ts
│   └── validators/                 # page, build, deploy
├── drizzle/                        # committed migrations
├── docker-compose.yml
├── Dockerfile                      # build-env, deps, migrator, builder, runner, build-worker
├── docs/                           # AI docs (this folder)
├── README.md
└── test.js
```

---

## Entry Points (per process)

| Process | File | Started by |
|---------|------|-----------|
| API server | `dist/src/server.js` | `express_app` |
| Build worker | `dist/src/queue/workers/build.worker.js` | `build_w` |
| Migrations | `drizzle-kit migrate` | `drizzle_migrator` (one-shot) |

No upload worker — CLI blob deploy replaced ZIP uploads.

---

## Key Constants (`src/constants/index.ts`)

| Constant | Value | Usage |
|----------|-------|-------|
| `TOP_LEVEL_DOMAIN` | `'localhost'` | Domain suffix for new pages |
| `MAX_FILE_SIZE` | 250 MB | Total deploy size cap (prepare) |
| `MAX_DEPLOY_FILE_SIZE` | 50 MB | Per-file magic-byte path (validator also enforces 10 MB) |
| `DEPLOY_TOKEN_TTL_SECONDS` | 10 min | `deploy:token:*` |
| `PRESIGN_EXPIRY_SECONDS` | 10 min | Presigned PUT lifetime |
| `DEPLOYMENT_RETENTION` | **10** | Keep this many **inactive** deployments; GC deletes the rest |
| `MANIFEST_REDIS_TTL_SECONDS` | 24 h | Redis `manifest:{deploymentId}` |
| `COMMIT_TIMEOUT_MS` | 5 min | `/api/deploy/commit` only |
| `BLOB_IO_CONCURRENCY` | 10 | `p-limit` for blob I/O + GC |
| `RATE_LIMIT_*` | 100 / 15 min | Express rate limit |

---

## Authentication

Every protected endpoint uses `authMiddleware`:
- `Authorization: Bearer <JWT>`
- JWKS: `AUTH_JWKS_URL` (Compose: `http://next_web:3000/api/auth/jwks`; host default `http://localhost:3080/api/auth/jwks`)
- Sets `req.id` = tenant ID, `req.name` = tenant name
- List/rollback filter by `tenant_id` — wrong tenant → empty list or 404, not a cross-tenant leak

---

## MinIO Storage Layout

```
{MINIO_BUCKET}/
  blobs/{sha256}          ← only live serving path (immutable objects)
  tenant/{site_id}/...    ← LEGACY — removed by migrate-to-blob-serving.ts
```

Caddy never reads `tenant/`. It resolves path → hash via the active deployment manifest → `blobs/{hash}`.

Blob objects may carry `Content-Type` and `Content-Encoding` (`br` / `gzip`) for precompressed variants.

---

## Redis Key Reference

| Key pattern | Redis DB | Type | TTL | Written by |
|------------|----------|------|-----|-----------|
| `site:{subdomain}` | 0 | String (UUID) | short | Caddy / invalidated by API |
| `active_deployment:{site_id}` | 0 | String (deployment ID) | short | deploy / rollback |
| `manifest:{deploymentId}` | 0 | JSON (`files` map path→SHA256) | 24 h | generateAndPersistManifest |
| `site_version:{site_id}` | 0 | Integer (INCR on deploy/rollback) | — | API (cache-bust Caddy L1) |
| `deploy:token:{token}` | 3 | JSON | 10 min | prepareDeploy |
| `requests:{domain}` | 3* | counter | — | Caddy |
| `bandwidth:{domain}` | 3* | counter | — | Caddy |
| `db_cache:{domain}` | 3* | JSON | 15 min | page.service |
| BullMQ keys | 2 | — | — | BullMQ |

\* Usage keys use the `usageRedis` client (DB3). Compose sets `IN_DOCKER_COMPOSE=1` so hostname `redis` is kept inside containers; host scripts remap to `localhost`.

---

## Deploy / GC flow (one-liner)

`commitBlobTreeDeploy` / rollback → `generateAndPersistManifest` → activate → `INCR site_version:{site_id}` + invalidate `site:` → **fire-and-forget** `runDeploymentGC(pageId, siteId)` (never await).
