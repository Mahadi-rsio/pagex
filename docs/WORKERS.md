# Cloudisy — BullMQ Workers Reference

---

## Queue Overview

| Queue name constant | Queue name string | Worker file | Job interface |
|--------------------|------------------|-------------|--------------|
| `CLOUDISY_CLOUD_BUILDS_QUEUE` | `"cloudisy-cloud-builds"` | `build.worker.ts` | `CloudBuildJob` |
| `CLOUDISY_CLOUD_BUILDS_DLQ` | `"cloudisy-cloud-builds-dlq"` | `dlq.worker.ts` | `FailedBuildJob` |

All workers share BullMQ `connection` from `src/infrastructure/cache/redis.ts` (Redis **DB2**).

ZIP **upload worker was removed**. CLI deploys use `/api/deploy/prepare|presign|commit`.

**Sync worker was removed.** Usage analytics are now flushed directly by the blob-server to `site_daily_stats` (via Redis `stats:*` keys) — no BullMQ cron.

---

## Build Worker

**File:** `src/queue/workers/build.worker.ts`  
**Triggered by:** `POST /api/builds`

### Job Data (`CloudBuildJob`)
```typescript
{
  buildId: string
  pageId: string
  tenantId: string
  siteId: string
  repoUrl: string
  gitProvider: string
  gitToken: string
  framework: string
  buildCommand: string
  outputDir: string | null
  envVars: Record<string, string>
}
```

### Execution Flow

```
Step 1 — Clone (10%)
  git clone --depth=1 → /tmp/cloudisy-builds/{jobId}

Step 2 — Docker Build (35%)
  docker run --memory 1g cloudisy-build-env:latest
  (pnpm install && {buildCommand})
  Stats every 2s → job.log("[Stats] …")

Step 3 — Detect Output Dir (70%)
  configured outputDir, else .next / dist / out / build / public

Step 4 — Validate + Deploy (90%)
  validateOutputDir(detectedDir)
    on failure → builds.status=failed, SSE error, return cleanly (no throw)
  deployFromLocalDirectory(…)
    → expand Brotli/Gzip/WebP variants
    → store blobs/{sha256}
    → commitBlobTreeDeploy (generates + persists manifest before activation)
    → fire-and-forget runDeploymentGC

Step 5 — Finalize (100%)
  builds.status=completed, cleanup clone dir
```

### Progress Milestones
| % | Step |
|---|------|
| 10 | Repo cloned |
| 35 | Docker build started |
| 70 | Output dir detected |
| 90 | Validated + blob deploy |
| 100 | DB finalized |

### Retry & DLQ Configuration

```typescript
defaultJobOptions: {
  attempts: 3,
  backoff: { type: 'exponential', delay: 10000 },  // 10s base
  removeOnComplete: 100,
  removeOnFail: 0,  // Keep failed jobs for DLQ processing
}
```

### Error Classification
**File:** `src/queue/jobs/build.queue.ts` → `classifyBuildError(error)`

| Category | Patterns | Behavior |
|----------|----------|----------|
| **Retryable** (default) | `econnrefused`, `etimedout`, `enotfound`, `socket hang up`, `network error`, `timeout`, `connection refused`, `connection reset`, `temporary failure`, `minio: connection`, `redis: connection`, `postgres: connection`, `docker: connection`, `git clone failed`, `git fetch failed`, `git push failed` | Retry up to 3x with exponential backoff |
| **Permanent** | `invalid repo`, `repository not found`, `authentication failed`, `permission denied`, `invalid token`, `build command failed`, `output directory not found`, `no files found in output`, `validation failed`, `blocked file`, `exceeds limit`, `manifest validation`, `invalid framework` | Fail immediately, move to DLQ |

### DLQ Handling
When a job fails permanently or exhausts retries:
1. `moveToDLQ()` enqueues to `cloudisy-cloud-builds-dlq` with `FailedBuildJob`:
   ```typescript
   {
     ...CloudBuildJob,
     failureReason: string,
     failedAt: ISO timestamp,
     attemptsMade: number,
     errorType: 'retryable' | 'permanent'
   }
   ```
2. **DLQ Worker** (`dlq.worker.ts`) logs full context for debugging/alerting
3. **No secrets** in DLQ — `gitToken` excluded from `FailedBuildJob`

---

## Commit path (`commitBlobTreeDeploy`)

**File:** `src/services/deploy.service.ts`

Shared by CLI commit and cloud builds. Serialized per page by Redis `deploy:lock:{pageId}` (DB3).

1. Acquire/refresh `deploy:lock:{pageId}` (SET NX, re-entrant for the same holder). Concurrent holders get HTTP 409.
2. If the caller provided `baseVersion`, abort when a newer `deployments.version` already exists (stale deploy).
3. Insert `deployments` row (`is_active: false`, `status: 'pending'`)
4. Insert `blob_tree_entries` (originals + `.br` / `.gz` / `.webp` variants)
5. `generateAndPersistManifest(deploymentId)` — build + validate + store manifest JSON to MinIO `manifests/{deploymentId}.json` and Redis `manifest:{deploymentId}` (TTL 24h). **Throws on any failure — deployment stays inactive.**
6. Abort (409) if a higher version row exists, or if the lock is no longer held.
7. **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark new deployment `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
8. **Redis updates ONLY after successful DB commit**:
   - `setActiveDeploymentCache` (Redis `active_deployment:{site_id}`)
   - `cacheManifestInRedis` + `incrementSiteVersion` (`INCR site_version:{site_id}`)
   - `invalidateSiteCache(subdomain)` — DEL `site:{subdomain}`
9. **Fire-and-forget** `runDeploymentGC(pageId, siteId)` — never await
10. Release the lock (CLI prepare holds it from token issue until commit `finally`)

No MinIO `tenant/` copy. Caddy resolves subdomain → site_id → active deployment → manifest → `blobs/{hash}`.

---

## Rollback (`rollbackToDeployment`)

**File:** `src/services/deployment.service.ts`

1. Load deployment (tenant-scoped); require blob tree
2. Acquire `deploy:lock:{pageId}` (409 if a deploy is in progress)
3. `generateAndPersistManifest(deploymentId)` — reuses the manifest (throws on failure → no activation)
4. Assert lock still held, then **ATOMIC ACTIVATION** (PostgreSQL transaction):
   - Mark rollback target `is_active: true, status: 'active'`
   - Mark previous active `is_active: false, status: 'superseded'`
5. **Redis updates ONLY after successful DB commit**:
   - `setActiveDeploymentCache` + `cacheManifestInRedis` + `incrementSiteVersion`
   - Invalidate `site:{subdomain}`
6. Fire-and-forget `runDeploymentGC`
7. Release the lock

---

## Background GC (`runDeploymentGC`)

**File:** `src/services/gc.service.ts`  
**Constant:** `DEPLOYMENT_RETENTION = 10` (inactive deployments kept)

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
  ├──→ failed (build/deploy error, NEVER becomes active)
  │
  └──→ superseded (newer deployment activated, or rollback to older)

FAILED deployment can NEVER become ACTIVE (enforced by CHECK constraint)
ACTIVE deployment MUST have finalized manifest (enforced by CHECK constraint)
```

---

## MinIO Helpers (`src/infrastructure/storage/minio.ts`)

| Function | Description |
|----------|-------------|
| `blobObjectKey(hash)` | `blobs/{hash}` |
| `objectMetaForPath(path, contentType?, contentEncoding?)` | PutObject metadata |
| `deleteBlobObjects(hashes)` | Batch delete; returns successfully deleted hashes |
| `ensureSharedBucket()` | Idempotent bucket create |
| `liveSitePrefix(siteId)` | Legacy `tenant/{siteId}/` (migration script only) |
| `SHARED_BUCKET` / `minioClient` | Env-driven bucket + client |

---

## Idempotency Keys

**File:** `src/services/idempotency.service.ts`

| Function | Purpose |
|----------|---------|
| `checkAndReserveIdempotencyKey()` | Insert if new; return existing if duplicate; verify request hash |
| `completeIdempotencyKey()` | Set `resource_id` after successful deployment/build creation |
| `failIdempotencyKey()` | Delete reservation on failure (allows retry) |
| `cleanupExpiredIdempotencyKeys()` | Periodic cleanup of expired keys |

**Scope:** `(tenant_id, page_id, idempotency_key)` — same key allowed across different pages/tenants
**Storage:** `idempotency_keys` table with TTL (`expires_at`)