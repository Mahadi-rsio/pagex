# PageX — Deploy Pipeline Reference

---

## Cloud builds & BullMQ workers removed

- **BullMQ has been removed** from the API. There are no `build.worker` / `dlq.worker` processes and no build/worker queues.
- **Cloud builds (git-repo → Docker build) are removed and postponed.** The `build-env`, `build-env-loader`, `build-worker`, and `docker-dind` Compose services, the `builds` API routes, and the seccomp profile have all been removed.
- **CLI deploy is the only deploy path.** Clients call `/api/deploy/prepare|presign|commit`; the API uploads/validates content-addressed blobs and activates a manifest via the shared commit path below.

Historical notes: the ZIP upload worker and the sync worker (analytics) were also removed earlier.

---

## Commit path (`commitBlobTreeDeploy`)

**File:** `services/console/src/server/api/services/deploy.service.ts`

Used by the CLI commit path. Serialized per page by Redis `deploy:lock:{pageId}`.

1. Acquire/refresh `deploy:lock:{pageId}` (SET NX, re-entrant for the same holder). Concurrent holders get HTTP 409.
2. If the caller provided `baseVersion`, abort when a newer `deployments.version` already exists (stale deploy).
3. Insert `deployments` row (`is_active: false`, `status: 'pending'`)
4. Insert `blob_tree_entries` (originals + `.br` / `.gz` / `.webp` variants)
5. `generateAndPersistManifest(deploymentId)` — build + validate + store manifest JSON to MinIO `manifests/{deploymentId}.json` and Redis `manifest:{deploymentId}` (TTL 24h). **Throws on any failure — deployment stays inactive.**
6. Abort (409) if a higher version row exists, or if the lock is no longer held.
7. **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark new deployment `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
8. **Redis updates ONLY after successful DB commit** (best-effort; a Redis outage never fails the deploy):
   - `setActiveDeploymentCache` — SET `site:{site_id}:active` (1 h safety TTL)
   - `cacheManifestInRedis` + `incrementSiteVersion` (`INCR site_version:{site_id}`)
   - The immutable `site:subdomain:{subdomain}` mapping is **not** touched by deploys
9. **Fire-and-forget** `runDeploymentGC(pageId, siteId)` — never await
10. Release the lock (CLI prepare holds it from token issue until commit `finally`)

No MinIO `tenant/` copy. Caddy resolves subdomain → site_id → active deployment → manifest → `blobs/{hash}`.

---

## Rollback (`rollbackToDeployment`)

**File:** `services/console/src/server/api/services/deployment.service.ts`

1. Load deployment (tenant-scoped); require blob tree
2. Acquire `deploy:lock:{pageId}` (409 if a deploy is in progress)
3. `generateAndPersistManifest(deploymentId)` — reuses the manifest (throws on failure → no activation)
4. Assert lock still held, then **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark rollback target `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
5. **Redis updates ONLY after successful DB commit** (best-effort):
   - `setActiveDeploymentCache` (SET `site:{site_id}:active`, 1 h) + `cacheManifestInRedis` + `incrementSiteVersion`
   - The immutable `site:subdomain:{subdomain}` mapping is **not** touched
6. Fire-and-forget `runDeploymentGC`
7. Release the lock

---

## Background GC (`runDeploymentGC`)

- **File:** `services/console/src/server/api/services/gc.service.ts`
- **Constant:** `DEPLOYMENT_RETENTION = 10` (inactive deployments kept)

```
1. SELECT id FROM deployments
     WHERE page_id=$1 AND is_active=false
     ORDER BY created_at DESC OFFSET 10
   → empty? return

2. DISTINCT blob_hash FROM blob_tree_entries WHERE deployment_id = ANY(expired)

3. Cross-check: drop hashes still referenced by non-expired deployments

4. deleteBlobObjects(orphans) — MinIO first (batches of 100, p-limit 10)
   Failed MinIO deletes are excluded from DB blob deletes

5. Transaction:
     DELETE blob_tree_entries WHERE deployment_id = ANY(expired)
     DELETE deployments WHERE id = ANY(expired)
     DELETE blobs WHERE hash = ANY(successfullyDeleted)

6. Log: GC complete: N deployments cleaned, M blobs deleted, X.Y MB freed
```

**Safety:**
- Active deployment never selected (`is_active = false` filter)
- MinIO delete before DB blob delete
- GC errors caught at call site (`GC failed silently`) — never fail commit/rollback
- Steady state: ≤ **11** rows per page (1 active + 10 inactive)

---

## Deployment State Machine

```
pending
  │
  ├──→ active (atomic DB transaction, manifest validated)
  │
  ├──→ failed (deploy error, NEVER becomes active)
  │
  └──→ superseded (newer deployment activated, or rollback to older)

FAILED deployment can NEVER become ACTIVE (enforced by CHECK constraint)
ACTIVE deployment MUST have finalized manifest (enforced by CHECK constraint)
```

---

## MinIO Helpers (`services/console/src/server/api/infrastructure/storage/minio.ts`)

| Function | Description |
|----------|-------------|
| `blobObjectKey(hash)` | `blobs/{hash}` |
| `objectMetaForPath(path, contentType?, contentEncoding?)` | PutObject metadata |
| `deleteBlobObjects(hashes)` | Batch delete; returns successfully deleted hashes |
| `ensureSharedBucket()` | Idempotent bucket create |
| `manifestObjectKey(deploymentId)` | `manifests/{deploymentId}.json` |
| `SHARED_BUCKET` / `minioClient` | Env-driven bucket + client |

---

## Idempotency Keys

**File:** `services/console/src/server/api/services/idempotency.service.ts`

| Function | Purpose |
|----------|---------|
| `checkAndReserveIdempotencyKey()` | Insert if new; return existing if duplicate; verify request hash |
| `completeIdempotencyKey()` | Set `resource_id` after successful deployment creation |
| `failIdempotencyKey()` | Delete reservation on failure (allows retry) |
| `cleanupExpiredIdempotencyKeys()` | Periodic cleanup of expired keys |

**Scope:** `(tenant_id, page_id, idempotency_key)` — same key allowed across different pages/tenants
**Storage:** `idempotency_keys` table with TTL (`expires_at`)
