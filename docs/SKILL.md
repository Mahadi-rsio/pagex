---
name: pagex-server
description: >
  AI skill for working on the PageX codebase.
  Multi-tenant static-site hosting backend: Express, PostgreSQL (Drizzle),
  Redis, MinIO blobs, Caddy static_s3 (blob-direct), CLI deploys,
  Vector log aggregation, deployment GC.
---

# PageX — AI Skill Guide

## Quick Orientation

Read docs in this order:

1. **[PROJECT.md](./PROJECT.md)** — File tree, entry points, constants, MinIO/Redis
2. **[SCHEMA.md](./SCHEMA.md)** — Tables + Redis keys + retention/GC
3. **[API.md](./API.md)** — HTTP endpoints (incl. `/internal/usage/ingest`)
4. **[WORKERS.md](./WORKERS.md)** — Deploy commit/rollback/GC flow
5. **[RULES.md](./RULES.md)** — Coding conventions
6. **[INFRASTRUCTURE.md](./INFRASTRUCTURE.md)** — Docker / Caddy / Vector

Also see `services/console/AGENTS.md` before touching the console.

---

## Common Tasks

### Add a New API Endpoint

1. Validator (Zod) in `services/api/validators/`
2. Service in `services/api/services/`
3. Thin controller in `services/api/controllers/`
4. Routes in `services/api/routes/` + mount in `services/api/routes/index.ts` (or `/internal` for internal-only)
5. `pnpm build:api` then `docker compose up -d --build api`

### Modify the Deployment Flow

Shared commit path: `services/api/services/deploy.service.ts` → `commitBlobTreeDeploy()`.
Per-page lock: `services/api/services/deployment-lock.service.ts` (`deploy:lock:{pageId}` on Redis DB3). Prepare acquires; commit/rollback refresh and release. Concurrent deploys for the same page return 409.

Rollback: `services/api/services/deployment.service.ts` → `rollbackToDeployment()`.

Background GC: `services/api/services/gc.service.ts` → `runDeploymentGC()` — always fire-and-forget, never await at call site.

Serving path: subdomain → site_id → active deployment manifest (MinIO `manifests/{deploymentID}.json`, cached in Postgres LRU) → path lookup → MinIO `blobs/{hash}`. Do not reintroduce `tenant/` copies.

### Metrics / Usage Pipeline

Caddy blob-server writes JSON access logs (`site_id`, `deployment_id`, `cache_hit`, `from_manifest`) to the shared `/var/log/caddy` volume.

Vector (`services/blob-server/vector/vector.yaml`) reads those logs, aggregates per site + hour in ~30s windows, and POSTs pre-aggregated records to `POST /internal/usage/ingest` (bearer token `USAGE_INGEST_TOKEN`).

The API's `usage-ingest.service.ts` applies each record transactionally into `bandwidth_usage_hourly`, `service_metrics_hourly`, and `site_daily_stats`, with idempotent dedup via `usage_ingest_dedup` (deterministic `ingest_id`).

**Constraints:**
- Requests are unlimited — never bill or quota-check request counts.
- Only **bandwidth** is billed, in decimal GB (1 GB = 1,000,000,000 bytes).
- **No Vector→Postgres sink.** The API owns the schema and DB access; Vector only POSTs to the ingest endpoint. Do not add DB credentials to Vector.
- Aggregate first, then apply — never store one row per request.

### Workers / Cloud Builds

BullMQ and cloud-build workers were removed — CLI deploy (`/api/deploy/prepare|presign|commit`) is the only deploy path. Do not add queue/worker infrastructure back.

### Check Deployments / GC

```bash
# Use PAGE id, not deployment id; JWT tenant must own the page
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/deployments/page/<pageUuid>

# Retention: 1 active + ≤10 inactive. GC logs:
docker logs api 2>&1 | grep 'GC complete'
```

### Roll Back

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/deployments/<deploymentId>/rollback
```

### Inspect Usage / Drizzle Studio

```bash
cd services/api
pnpm db:studio        # Drizzle Studio GUI
```

---

## Architecture Summary

| Component | One-liner |
|-----------|-----------|
| `deploy.service.ts` | prepare / presign / commit + compress/WebP + manifest |
| `deployment.service.ts` | list + rollback + fire GC |
| `gc.service.ts` | prune inactive beyond retention 10 + orphaned MinIO blobs |
| `usage-ingest.service.ts` | apply Vector aggregates transactionally (idempotent dedup) |
| `minio.ts` | `blobs/{hash}` / `manifests/{id}.json` helpers + `deleteBlobObjects` |
| `redis.ts` | DB0 site/active_deployment/manifest · DB3 tokens/locks/cache |
| blob-server (`src/`) | Go static_s3 plugin; LRU→PostgreSQL cache; writes access logs |
| vector (`vector/vector.yaml`) | log aggregate per site+hour → POST ingest |