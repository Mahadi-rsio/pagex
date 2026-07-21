# Cloudisy — BullMQ Workers Reference

---

## Queue Overview

| Queue name constant | Queue name string | Worker file | Job interface |
|--------------------|------------------|-------------|--------------|
| `UPLOAD_QUEUE` | `"UPLOAD_QUEUE"` | `upload.worker.ts` | `UploadJobData` |
| `CLOUDISY_CLOUD_BUILDS_QUEUE` | `"cloudisy-cloud-builds"` | `build.worker.ts` | `CloudBuildJob` |
| `SYNC_QUEUE` | `"SYNC_QUEUE"` | `sync.worker.ts` | (no data) |

All workers share the same Redis connection from `src/infrastructure/cache/redis.ts`.

---

## Upload Worker

**File:** `src/queue/workers/upload.worker.ts`
**Triggered by:** `POST /upload/:pageIdOrName`

### Job Data (`UploadJobData`)
```typescript
{
  path: string;       // absolute path to saved ZIP on disk (temp_zips/)
  site_id: string;    // UUID from sites table (MinIO prefix)
  page_id: string;    // UUID from pages table
  tenant_id: string;  // tenant identifier from JWT
}
```

### Execution Flow
```
upload.worker.ts
  → processUpload(path, site_id, page_id, tenant_id)   [upload.service.ts]
    → executeDeploymentFlow(pageId, tenantId, siteId, 'upload', null, uploadFn)
      1. Find current active deployment (SELECT from deployments)
      2. Get next version number
      3. SNAPSHOT: copyFolder(siteId/ → cloudisy-snapshots/siteId/vN/)
      4. INSERT deployments row (is_active: false, file_count: 0)
      5. deleteFolder(siteId/)          ← brief 404 window
      6. uploadFn() callback runs:
           - Open.file(path)            ← unzipper
           - For each file in zip:
               minioClient.putObject(siteId/filepath, buffer)
           - unlinkSync(path)           ← delete temp ZIP
           - Returns file count
      7. UPDATE deployments SET is_active=true, file_count=N WHERE id=newDep.id
      8. UPDATE deployments SET is_active=false WHERE page_id=... AND id != newDep.id
      9. PRUNE: delete oldest deployments beyond 5 (MinIO objects + DB rows)
```

**Retry config:** 3 attempts, exponential backoff starting 5s.

---

## Build Worker

**File:** `src/queue/workers/build.worker.ts`
**Triggered by:** `POST /api/builds`

### Job Data (`CloudBuildJob`)
```typescript
{
  buildId: string;       // UUID of builds row
  pageId: string;        // UUID of pages row
  tenantId: string;      // tenant ID
  siteId: string;        // UUID of sites row (MinIO prefix)
  repoUrl: string;       // HTTPS git URL
  gitProvider: string;   // 'github' | 'gitlab'
  gitToken: string;      // PAT for private repos
  framework: string;     // e.g. 'vite'
  buildCommand: string;  // e.g. 'pnpm build'
  outputDir: string | null; // null = auto-detect
  envVars: Record<string, string>; // injected into docker
}
```

### Execution Flow (5 steps + resource tracking)

```
Step 1 — Clone (10%)
  await job.log("Step 1: Cloning repository...")
  git clone --depth=1 https://oauth2:{gitToken}@{repoUrl} /tmp/cloudisy-builds/{jobId}

Step 2 — Docker Build (35%)
  Container name: cloudisy-build-{jobId}
  Memory limit:   --memory 1g
  Image:          cloudisy-build-env:latest (pnpm pre-installed)
  Mount:          /tmp/cloudisy-builds/{jobId}:/app  (host path)
  Command:        sh -c "(pnpm install --frozen-lockfile || pnpm install) && {buildCommand}"

  Parallel stats poll (every 2s):
    docker stats --no-stream --format "RAM: {{.MemUsage}} | Net I/O: {{.NetIO}}" {containerName}
    → job.log("[Stats] RAM: 350MiB / 1GiB | Net I/O: 46.8MB / 317kB")

  On failure: docker kill cloudisy-build-{jobId}

Step 3 — Detect Output Dir (70%)
  If outputDir set → verify it exists
  Else → check in order: .next, dist, out, build, public

Step 4 — Deploy (90%)
  executeDeploymentFlow(pageId, tenantId, siteId, 'build', buildId, uploadFn)
    (same snapshot/deploy/activate/prune flow as upload worker)
    uploadFn:
      getFilesRecursively(detectedDir)
      for each file: minioClient.putObject(siteId/relativePath, buffer, mimeType)
      returns file count

Step 5 — Finalize (100%)
  job.log("[Stats] Total Build Duration: {N}s")
  UPDATE builds SET status='completed', completed_at=now()
  fs.rm(cloneDir, { recursive: true })   ← cleanup clone
```

### Error Handling
- Any thrown error sets `builds.status = 'failed'`, `error = err.message`
- Docker container is force-killed: `docker kill cloudisy-build-{jobId}`
- Clone directory is cleaned up regardless

### Progress Milestones
| % | Step |
|---|------|
| 10 | Repo cloned |
| 35 | Docker build started |
| 70 | Output dir detected |
| 90 | Files uploaded to MinIO |
| 100 | DB finalized |

---

## Sync Worker

**File:** `src/queue/workers/sync.worker.ts`
**Schedule:** Every 2 minutes (`0 */2 * * * *`)

### Execution Flow
```
For each domain tracked in Redis (keys matching "requests:*"):
  1. Get requests:{domain} from Redis
  2. Get bandwidth:{domain} from Redis
  3. UPDATE pages SET request += redisReqs, bandwidth_usage += redisBw WHERE domain = domain
  4. DEL requests:{domain}, bandwidth:{domain}
  5. DEL db_cache:{domain}  ← invalidate cached usage
```

---

## Deployment Service (`executeDeploymentFlow`)

**File:** `src/services/deployment.service.ts`

This is the **shared deploy lifecycle** called by both upload and build workers.

```typescript
executeDeploymentFlow(
  pageId: string,
  tenantId: string,
  siteId: string,
  source: 'build' | 'upload',
  buildId: string | null,
  uploadFn: () => Promise<number>   // must return file count
): Promise<deployment row>
```

**Steps:**
1. Find `is_active = true` deployment for this page
2. Determine `nextVersion = latest.version + 1` (or 1 if none)
3. `copyFolder(siteId/ → cloudisy-snapshots/siteId/vN/)` if active exists
4. `INSERT deployments` (is_active: false)
5. `deleteFolder(siteId/)` — deletes live files
6. `await uploadFn()` — uploads new files, returns count
7. `UPDATE deployments SET is_active=true, file_count=count`
8. `UPDATE deployments SET is_active=false WHERE page_id=... AND id != new`
9. Prune: query all deployments DESC, delete beyond index 5 (MinIO + DB)

**Rollback (`rollbackToDeployment`):**
1. Load target deployment (verify tenantId)
2. Find currently active deployment
3. Backup current live → `cloudisy-snapshots/siteId/v{active.version}/`
4. `deleteFolder(siteId/)`
5. `copyFolder(snapshot_prefix → siteId/)`
6. Flip `is_active` flags

---

## MinIO Helpers (`src/infrastructure/storage/minio.ts`)

| Function | Signature | Description |
|----------|-----------|-------------|
| `deleteSiteObjects(siteId)` | `(string) → void` | Delete all `{siteId}/` objects |
| `copyFolder(src, dest)` | `(string, string) → number` | Copy all objects from src prefix to dest prefix. Returns count |
| `deleteFolder(prefix)` | `(string) → void` | Delete all objects under prefix |
| `SHARED_BUCKET` | `string` | Env `MINIO_BUCKET` (default: `cloudisy-sites`) |
