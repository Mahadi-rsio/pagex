# PageX — Project Map

> **Purpose of this file:** Give an AI assistant a dense, token-efficient snapshot of the entire project so it can navigate and edit code accurately without needing to read every source file.

---

## What This Is

**PageX** is a multi-tenant static-site hosting platform. Each user project ("page") is served as a subdomain (`project.example.com`) from content-addressed MinIO blobs via a custom Caddy plugin and deployment manifests. Zero per-tenant Caddy config changes are needed.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 20.9+ with Next.js 16 App Router |
| HTTP Framework | Next.js route handlers |
| Database | PostgreSQL via Drizzle ORM |
| Deploy path | CLI only — `/api/deploy/prepare\|presign\|commit` |
| Cache | Redis (ioredis) — API cache/rate-limit/deploy-locks; blob-server caches in PostgreSQL |
| Object Storage | MinIO (S3-compatible) — external |
| Auth | Better Auth JWT + JOSE JWKS verification |
| Image / compress | `sharp` (WebP), Node `zlib` (Brotli/Gzip) |
| Validation | Zod + `file-type` magic bytes |
| Rate limiting | Redis Lua counter |
| Concurrency | `p-limit` (blob I/O + GC deletes, concurrency 10) |

---

## Monorepo Layout

```
pagex/
├── services/
│   ├── console/                    # Next.js UI and native API
│   │   ├── src/app/                # API/auth/health/ingest route handlers
│   │   ├── src/server/api/
│   │   │   ├── http/               # dispatcher, JWT auth, Redis rate limits
│   │   │   ├── services/           # page, deploy, deployment, GC, usage
│   │   │   ├── infrastructure/     # DB, Redis, MinIO
│   │   │   ├── validators/ utils/
│   │   │   └── constants/
│   │   ├── src/modules/api/schemas/api.schema.ts
│   │   ├── drizzle/                # auth migration history
│   │   └── drizzle-api/            # page/deploy/usage migration history
│   └── blob-server/                # Go Caddy static_s3 plugin
├── packages/                       # @pagex/{config,types,utils}
├── cli/                            # `pagex` CLI — init/deploy/status
├── docker-compose.yml              # blob-server, vector, console, db, redis
├── docker-compose.prod.yml         # GHCR images, no build
├── Caddyfile                       # reverse proxy + static_s3
├── docs/
└── README.md
```

---

## Entry Points (per process)

| Process | File | Started by |
|---------|------|-----------|
| Console UI/API | `services/console/src/app/` | `console` |
| Migrations | `src/db/migrate.ts` | run at console startup |
| Blob server | `cmd/caddy` (Go) | `blob-server` |
| Vector | `vector.yaml` | `vector` (aggregates access logs → console ingest) |

No workers — cloud builds / BullMQ were removed, and CLI blob deploy replaced ZIP uploads.

---

## Key Constants (`services/console/src/server/api/constants/index.ts`)

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
| `RATE_LIMIT_*` | 100 / 15 min | Native API rate limit |

---

## Authentication

Every protected endpoint uses native request authentication:
- `Authorization: Bearer <JWT>`
- JWKS defaults to the request origin's `/api/auth/jwks`; `AUTH_JWKS_URL` can override it
- The auth context contains `id` = tenant ID and `name` = tenant name
- List/rollback operations filter by `tenant_id` — wrong tenant → empty list or 404, not a cross-tenant leak

---

## MinIO Storage Layout

```
{MINIO_BUCKET}/
  blobs/{sha256}          ← only live serving path (immutable objects)
  manifests/{deploymentID}.json ← immutable deployment manifests
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
| `db_cache:{domain}` | 3 | JSON | 15 min | page.service |

Usage/metrics aggregation is handled by **Vector → console ingest** (Postgres); no analytics counters live in Redis. Blob-server caches in PostgreSQL (LRU → Postgres).

Compose sets `IN_DOCKER_COMPOSE=1` so hostname `redis` is kept inside containers; host scripts remap to `localhost`.

---

## Deploy / GC flow (one-liner)

`commitBlobTreeDeploy` / rollback → `generateAndPersistManifest` → activate → `INCR site_version:{site_id}` + invalidate `site:` → **fire-and-forget** `runDeploymentGC(pageId, siteId)` (never await).
