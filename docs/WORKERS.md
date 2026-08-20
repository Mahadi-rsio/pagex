# Cloudisy — BullMQ Workers Reference

---

## Queue Overview

| Queue name constant | Queue name string | Worker file | Job interface |
|--------------------|------------------|-------------|--------------|
| `CLOUDISY_CLOUD_BUILDS_QUEUE` | `"cloudisy-cloud-builds"` | `build.worker.ts` | `CloudBuildJob` |

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

---

## Commit path (`commitBlobTreeDeploy`)

**File:** `src/services/deploy.service.ts`

Shared by CLI commit and cloud builds:

1. Insert `deployments` row (`is_active: false`)
2. Insert `blob_tree_entries` (originals + `.br` / `.gz` / `.webp` variants)
3. `generateAndPersistManifest(deploymentId)` — build + validate + store manifest JSON to MinIO `manifests/{deploymentId}.json` and Redis `manifest:{deploymentId}` (TTL 24h). **Throws on any failure — deployment stays inactive.**
4. Activate deployment (flip `is_active`)
5. `setActiveDeploymentCache` (Redis `active_deployment:{site_id}`) + `incrementSiteVersion` (`INCR site_version:{site_id}`)
6. `invalidateSiteCache(subdomain)` — DEL `site:{subdomain}`
7. **Fire-and-forget** `runDeploymentGC(pageId, siteId)` — never await

No MinIO `tenant/` copy. Caddy resolves subdomain → site_id → active deployment → manifest → `blobs/{hash}`.

---

## Rollback (`rollbackToDeployment`)

**File:** `src/services/deployment.service.ts`

1. Load deployment (tenant-scoped); require blob tree
2. `generateAndPersistManifest(deploymentId)` — reuses the manifest (throws on failure → no activation)
3. Activate target deployment
4. `setActiveDeploymentCache` + `cacheManifestInRedis` + `incrementSiteVersion`
5. Invalidate `site:{subdomain}`
6. Fire-and-forget `runDeploymentGC`

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

## MinIO Helpers (`src/infrastructure/storage/minio.ts`)

| Function | Description |
|----------|-------------|
| `blobObjectKey(hash)` | `blobs/{hash}` |
| `objectMetaForPath(path, contentType?, contentEncoding?)` | PutObject metadata |
| `deleteBlobObjects(hashes)` | Batch delete; returns successfully deleted hashes |
| `ensureSharedBucket()` | Idempotent bucket create |
| `liveSitePrefix(siteId)` | Legacy `tenant/{siteId}/` (migration script only) |
| `SHARED_BUCKET` / `minioClient` | Env-driven bucket + client |
