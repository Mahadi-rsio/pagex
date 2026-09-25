# PageX — Background Workers & Deploy Path Reference

---

## Deploy Architecture Overview

BullMQ workers and cloud builds have been **removed**.

The CLI deploy path is the **only supported deployment mechanism**:
- `/api/deploy/prepare`
- `/api/deploy/presign`
- `/api/deploy/commit`

All async queue dependencies (BullMQ) have been removed from the API service. Redis remains in place for caching, rate limiting, and project deployment locks (`deploy:lock:{pageId}`).

---

## Commit path (`commitBlobTreeDeploy`)

**File:** `src/services/deploy.service.ts`

Shared by CLI commit actions. Serialized per page by Redis `deploy:lock:{pageId}`.

1. Acquire/refresh `deploy:lock:{pageId}` (SET NX, re-entrant for the same holder). Concurrent holders get HTTP 409.
2. If the caller provided `baseVersion`, abort when a newer `deployments.version` already exists (stale deploy).
3. Insert `deployments` row (`is_active: false`, `status: 'pending'`).
4. Insert `blob_tree_entries` (originals + `.br` / `.gz` / `.webp` variants).
5. `generateAndPersistManifest(deploymentId)` — build + validate + store manifest JSON to MinIO `manifests/{deploymentId}.json` and Redis `manifest:{deploymentId}` (TTL 24h). **Throws on any failure — deployment stays inactive.**
6. Abort (409) if a higher version row exists, or if the lock is no longer held.
7. **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark new deployment `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
8. **Redis updates ONLY after successful DB commit**:
   - `setActiveDeploymentCache` (Redis `active_deployment:{site_id}`)
   - `cacheManifestInRedis` + `incrementSiteVersion` (`INCR site_version:{site_id}`)
   - `invalidateSiteCache(subdomain)` — DEL `site:{subdomain}`
9. **Fire-and-forget** `runDeploymentGC(pageId, siteId)` — never await.
10. Release the lock.

---

## Rollback (`rollbackToDeployment`)

**File:** `src/services/deployment.service.ts`

1. Load deployment (tenant-scoped); require blob tree.
2. Acquire `deploy:lock:{pageId}` (409 if a deploy is in progress).
3. `generateAndPersistManifest(deploymentId)` — reuses the manifest (throws on failure → no activation).
4. Assert lock still held, then **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark rollback target `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
5. **Redis updates ONLY after successful DB commit**:
   - `setActiveDeploymentCache` + `cacheManifestInRedis` + `incrementSiteVersion`
   - Invalidate `site:{subdomain}`
6. Fire-and-forget `runDeploymentGC`.
7. Release the lock.

---

## Background GC (`runDeploymentGC`)

**File:** `src/services/gc.service.ts`  
**Constant:** `DEPLOYMENT_RETENTION = 10` (inactive deployments kept)

1. Select inactive deployments beyond retention limit per page.
2. Find orphan blob hashes not referenced by active or retained deployments.
3. Batch delete orphan objects from MinIO storage.
4. Clean up `blob_tree_entries`, `deployments`, and `blobs` database records.

---

## Idempotency Keys

**File:** `src/services/idempotency.service.ts`

Handles idempotency reservations during CLI deployment prepare/commit phases.
