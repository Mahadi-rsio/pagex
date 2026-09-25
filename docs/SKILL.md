---
name: pagex-server
description: >
  AI skill for the PageX codebase. Multi-tenant static hosting with a Next.js
  native API, PostgreSQL/Drizzle, Redis, MinIO blobs, Caddy static_s3,
  CLI deploys, Vector usage aggregation, and deployment GC.
---

# PageX — AI Skill Guide

## Quick Orientation

Read in this order:

1. `docs/PROJECT.md`
2. `docs/SCHEMA.md`
3. `docs/API.md`
4. `docs/WORKERS.md`
5. `docs/RULES.md`
6. `docs/INFRASTRUCTURE.md`

Also read `services/console/AGENTS.md` before changing console code.

## Add a Native API Endpoint

1. Add a Zod validator in `services/console/src/server/api/validators/`.
2. Add business logic in `services/console/src/server/api/services/`.
3. Add path/method matching and request handling in `services/console/src/server/api/http/dispatcher.ts`.
4. Add a dedicated App Router handler under `services/console/src/app/` only when the endpoint needs a path outside the public `/api/*` dispatcher.
5. Add tests under `services/console/tests/`.
6. Run `pnpm test:console`, typecheck, and build the console.

## Deployment Flow

- Prepare/presign/commit: `services/console/src/server/api/services/deploy.service.ts`
- Per-page lock: `services/console/src/server/api/services/deployment-lock.service.ts`
- Rollback: `services/console/src/server/api/services/deployment.service.ts`
- Fire-and-forget GC: `services/console/src/server/api/services/gc.service.ts`

Serving path: subdomain → site ID → active deployment manifest → path lookup → `blobs/{hash}`. Do not reintroduce `tenant/` object copies.

## Usage Pipeline

Caddy writes JSON access logs to the shared `caddy_logs` volume. Vector aggregates them by site and hour, then posts to `/internal/usage/ingest` with `USAGE_INGEST_TOKEN`.

The console's `usage-ingest.service.ts` applies aggregates transactionally with deterministic deduplication.

- Requests are unlimited and are never billed.
- Only bandwidth is billed, in decimal GB.
- Vector has no PostgreSQL credentials and never writes to the database directly.
- Aggregate first; do not store one row per request.

## Operational Checks

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3080/api/deployments/page/<pageUuid>

curl -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3080/api/deployments/<deploymentId>/rollback

docker logs web
```

Drizzle commands run from the repository root and target the console's separate auth and API migration histories:

```bash
pnpm db:generate
pnpm db:migrate
pnpm db:studio
```

## Architecture Summary

| Component | Role |
|-----------|------|
| `src/app/api/[...path]/route.ts` | Public native API entry |
| `src/server/api/http/dispatcher.ts` | Route matching, auth, rate limits, dispatch |
| `src/server/api/services/deploy.service.ts` | Prepare, presign, commit, compression, manifests |
| `src/server/api/services/deployment.service.ts` | List, rollback, trigger GC |
| `src/server/api/services/gc.service.ts` | Retention and orphan cleanup |
| `src/server/api/services/usage-ingest.service.ts` | Idempotent Vector aggregate ingestion |
| `src/server/api/infrastructure/storage/minio.ts` | Lazy MinIO client and object helpers |
| `src/server/api/infrastructure/cache/redis.ts` | Caches, rate limits, deploy tokens/locks |
| Blob server | Go static_s3 plugin and access logs |
| Vector | Per-site/hour usage aggregation and console ingest |
