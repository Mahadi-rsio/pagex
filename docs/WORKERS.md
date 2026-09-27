# PageX — Deploy Pipeline Reference

---

## Cloud builds & BullMQ workers removed

- **BullMQ has been removed** from the API. There are no `build.worker` / `dlq.worker` processes and no build/worker queues.
- **Cloud builds (git-repo → Docker build) are removed and postponed.** The `build-env`, `build-env-loader`, `build-worker`, and `docker-dind` Compose services, the `builds` API routes, and the seccomp profile have all been removed.
- **CLI deploy is the only deploy path.** Clients call `/api/deploy/prepare|presign|commit`; the API uploads/validates content-addressed blobs and activates a manifest via the shared commit path below.

Historical notes: the ZIP upload worker and the sync worker (analytics) were also removed earlier.

---

## Cleanup worker (added)

The removal above applies to **build** work only. There is one long-lived worker: `services/worker` (Go), which drains the Cloudflare Queue `pagex-background` over the HTTP Pull API and performs exactly two jobs:

| Job | When enqueued | Effect |
|---|---|---|
| `deployment_gc` | after a commit activates a deployment | prune the superseded deployment and orphaned blobs |
| `page_delete` | after `DELETE /api/pages/[id]` soft-deletes a project | delete the project's manifests, blobs, and rows (keeping the inactive `sites` row so the subdomain stays reserved) |

It is never in the deploy request path: producers swallow queue errors, so a committed deploy or delete is never failed by queue downtime. Project deletion is a deliberate two-phase design — the console hides the project synchronously, the worker reclaims storage asynchronously.

See `services/console/docs/queue.md` for the full design and `services/worker/README.md` for configuration.

---

## Commit path (`commitBlobTreeDeploy`)

**File:** `services/console/src/features/deployments/deploy.service.ts`

Used by the CLI commit path. Serialized per page by Redis `deploy:lock:{pageId}`.

1. Acquire/refresh `deploy:lock:{pageId}` (SET NX, re-entrant for the same holder). Concurrent holders get HTTP 409.
2. If the caller provided `baseVersion`, abort when a newer `deployments.version` already exists (stale deploy).
3. Insert `deployments` row (`is_active: false`, `status: 'pending'`)
4. Insert `blob_tree_entries` (originals + `.br` / `.gz` variants; no generated image variants)
5. `generateAndPersistManifest(deploymentId)` — build + validate + store manifest JSON to MinIO `manifests/{deploymentId}.manifest.json` and Redis `manifest:{deploymentId}` (TTL 24h). **Throws on any failure — deployment stays inactive.**
6. Abort (409) if a higher version row exists, or if the lock is no longer held.
7. **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Re-read `pages.deleted_at`; **abort 409** if the project was deleted mid-flight. This makes activation mutually exclusive with a concurrent delete.
   - Deactivate the previous active deployment (`is_active: false, status: 'superseded'`) **first**.
   - Then activate the new deployment (`is_active: true, status: 'active'`).

   The order is not arbitrary: the partial unique index
   `deployments_page_id_is_active_uid` (`WHERE is_active = true`) rejects two
   active rows for one page. Activating before deactivating trips it.
8. **Redis updates ONLY after successful DB commit** (best-effort; a Redis outage never fails the deploy):
   - `setActiveDeploymentCache` — SET `site:{site_id}:active` (1 h safety TTL)
   - `cacheManifestInRedis` + `incrementSiteVersion` (`INCR site_version:{site_id}`)
   - The immutable `site:subdomain:{subdomain}` mapping is **not** touched by deploys
9. **Enqueue** `deployment_gc` to the Cloudflare queue (awaited, best-effort) — drained by `services/worker`. The deployment is already live, so a queue outage only delays pruning.
10. Release the lock (CLI prepare holds it from token issue until commit `finally`)

No MinIO `tenant/` copy. Caddy resolves subdomain → site_id → active deployment → manifest → `blobs/{hash}`.

---

## Rollback (`rollbackToDeployment`)

**File:** `services/console/src/features/deployments/deployment.service.ts`

1. Load deployment (tenant-scoped); require blob tree
2. Acquire `deploy:lock:{pageId}` (409 if a deploy is in progress)
3. `generateAndPersistManifest(deploymentId)` — reuses the manifest (throws on failure → no activation)
4. Assert lock still held, then **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Re-read `pages.deleted_at`; abort 409 if the project was deleted mid-flight
   - Deactivate the previous active deployment **first**, then activate the rollback target. The order is forced by the `deployments_page_id_is_active_uid` partial unique index.
5. **Redis updates ONLY after successful DB commit** (best-effort):
   - `setActiveDeploymentCache` (SET `site:{site_id}:active`, 1 h) + `cacheManifestInRedis` + `incrementSiteVersion`
   - The immutable `site:subdomain:{subdomain}` mapping is **not** touched
6. **Enqueue** `deployment_gc` to the Cloudflare queue (awaited, best-effort)
7. Release the lock

---

## Deployment GC (worker-side)

The in-process `runDeploymentGC` / `gc.service.ts` has been **removed**. Pruning
now runs in the Go worker.

- **File:** `services/worker/internal/cleanup/deployment_gc.go`
- **Enqueued by:** deploy commit and rollback, as a `deployment_gc` message
- **Constant:** `DEPLOYMENT_RETENTION = 10` (inactive deployments kept per page)

```
1. SELECT id FROM deployments
     WHERE page_id=$1 AND is_active=false
     ORDER BY created_at DESC OFFSET 10
   → empty? return

2. DISTINCT blob_hash FROM blob_tree_entries WHERE deployment_id = ANY(expired)

3. Cross-check: drop hashes still referenced by non-expired deployments

4. deleteBlobObjects(orphans) — S3 first (batches of 100)
   Failed S3 deletes are excluded from DB blob deletes

5. Transaction:
     DELETE blob_tree_entries WHERE deployment_id = ANY(expired)
     DELETE deployments     WHERE id = ANY(expired)
     DELETE blobs           WHERE hash = ANY(successfullyDeleted)

6. Log: deployment_gc complete page_id=… deployments_removed=N blobs_removed=M
```

**Safety:**
- The active deployment is never selected (`is_active = false` filter)
- S3 objects are deleted **before** the `blobs` rows, so a retry can still find them
- Blob hashes shared with a live deployment are skipped
- Handler errors are returned, not swallowed, so the queue retries them. A
  permanently failing job lands in the DLQ rather than losing cleanup silently.
- Steady state: ≤ **11** rows per page (1 active + 10 inactive)

---

## Project deletion (two-phase)

**Console — `services/console/src/features/projects/page.service.ts` → `deletePage`** (synchronous):
soft-delete the page, deactivate the site, take the delete fence, clear routing
and cache keys, enqueue `page_delete`. Returns success even if the enqueue
fails — the project is already invisible to the user.

**Worker — `services/worker/internal/cleanup/page_delete.go`** (asynchronous):
inventory deployments and unreferenced blob hashes, delete manifests then blobs,
then delete the project's rows in one transaction. **The `sites` row is kept**
(inactive) so `sites.subdomain` stays reserved.

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
| `manifestObjectKey(deploymentId)` | `manifests/{deploymentId}.manifest.json` |
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
