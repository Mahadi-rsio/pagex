---
name: cloudisy-server
description: >
  AI skill for working on the Cloudisy Server codebase.
  Multi-tenant static-site hosting backend: Express, PostgreSQL (Drizzle),
  Redis, BullMQ, MinIO blobs, Caddy static_s3 (blob-direct), cloud builds,
  deployment GC.
---

# Cloudisy Server — AI Skill Guide

## Quick Orientation

Read docs in this order:

1. **[PROJECT.md](./PROJECT.md)** — File tree, entry points, constants, MinIO/Redis
2. **[SCHEMA.md](./SCHEMA.md)** — Tables + Redis keys + retention/GC
3. **[API.md](./API.md)** — HTTP endpoints
4. **[WORKERS.md](./WORKERS.md)** — Build worker + commit/GC flow
5. **[RULES.md](./RULES.md)** — Coding conventions
6. **[INFRASTRUCTURE.md](./INFRASTRUCTURE.md)** — Docker / Caddy

---

## Common Tasks

### Add a New API Endpoint

1. Validator (Zod) in `src/validators/`
2. Service in `src/services/`
3. Thin controller in `src/controllers/`
4. Routes in `src/routes/` + mount in `src/routes/index.ts`
5. `npm run build` then `docker compose up --build -d --remove-orphans app`

### Modify the Deployment Flow

Shared commit path: `src/services/deploy.service.ts` → `commitBlobTreeDeploy()`.
Per-page lock: `src/services/deployment-lock.service.ts` (`deploy:lock:{pageId}` on Redis DB3). Prepare acquires; commit/rollback/cloud-build commit refresh and release. Concurrent deploys for the same page return 409.

Rollback: `src/services/deployment.service.ts` → `rollbackToDeployment()`.

Background GC: `src/services/gc.service.ts` → `runDeploymentGC()` — always fire-and-forget, never await at call site.

Serving path: subdomain → site_id → active deployment manifest (MinIO `manifests/{deploymentID}.json` / Redis `manifest:{deploymentId}`) → path lookup → MinIO `blobs/{hash}`. Do not reintroduce `tenant/` copies.

### Add a New BullMQ Worker

1. Job in `src/queue/jobs/`
2. Worker in `src/queue/workers/`
3. Dockerfile stage + `docker-compose.yml` service with `IN_DOCKER_COMPOSE=1`

### Debug a Failed Build

```bash
docker logs build_w --tail 50
docker logs express_app --tail 20
docker exec -it postgres_db psql -U postgres -d mydb \
  -c "SELECT id, status, error FROM builds ORDER BY created_at DESC LIMIT 5;"
```

### Check Deployments / GC

```bash
# Use PAGE id, not deployment id; JWT tenant must own the page
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/deployments/page/<pageUuid>

# Retention: 1 active + ≤10 inactive. GC logs:
docker logs express_app 2>&1 | grep 'GC complete'
```

### Roll Back

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/deployments/<deploymentId>/rollback
```

### One-time Legacy Cleanup

```bash
npx tsx src/scripts/migrate-to-blob-serving.ts
```

---

## Architecture Summary

| Component | One-liner |
|-----------|-----------|
| `deploy.service.ts` | prepare / presign / commit + compress/WebP + manifest |
| `deployment.service.ts` | list + rollback + fire GC |
| `gc.service.ts` | prune inactive beyond retention 10 + orphaned MinIO blobs |
| `build.worker.ts` | clone → docker build → validateOutputDir → deployFromLocalDirectory |
| `minio.ts` | `blobs/{hash}` helpers + `deleteBlobObjects` |
| `redis.ts` | DB0 site/active_deployment/manifest · DB2 BullMQ · DB3 tokens/usage |
