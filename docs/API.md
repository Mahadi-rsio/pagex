# PageX — Complete API Reference

> All endpoints are served by the console (default: `http://localhost:3080`).
> All protected endpoints require: `Authorization: Bearer <JWT>`
> The JWT is issued by Better Auth. The payload must contain `id` (tenant ID) and `name` (tenant name); the native API verifies its signature through the console JWKS endpoint.

---

## Health

### `GET /health`
No auth required.

**Response `200`:**
```json
{ "message": "ok" }
```

---

## Internal — Usage Ingest

### `POST /internal/usage/ingest`
**Internal-only** endpoint used by the Vector service to push pre-aggregated hourly usage records. The native route reads raw JSON/NDJSON and bypasses the public rate limiter.

**Auth:** Bearer token compared constant-time against `USAGE_INGEST_TOKEN` (NOT the public JWT `authMiddleware`).
- `401` if the token is missing or wrong.
- `500` if `USAGE_INGEST_TOKEN` is not configured.

**Body:** A JSON array **or** newline-delimited JSON (NDJSON) of pre-aggregated hourly records. Use `Content-Type: application/x-ndjson` for NDJSON.

Each record fields:

| Field | Notes |
|-------|-------|
| `ingest_id` | Deterministic idempotency key (string) |
| `site_id` | Site UUID |
| `bucket` | ISO hour, e.g. `"2026-09-24T14:00:00.000Z"` |
| `bandwidth_bytes` | Bandwidth in bytes |
| `requests` | Request count |
| `status_2xx` / `status_3xx` / `status_4xx` / `status_5xx` | Per-status-class counts |
| `cache_hits` / `cache_misses` | Cache counts |
| `latency_sum_ms` | Sum of latencies in ms |
| `latency_le_50` / `latency_le_100` / `latency_le_250` / `latency_le_500` / `latency_le_1000` / `latency_le_2500` | Latency histogram buckets |

**Response `200`:**
```json
{ "ok": true, "applied": <n>, "skipped": <n> }
```

| Status | Meaning |
|--------|---------|
| `200` | `{ ok: true, applied, skipped }` |
| `400` | `"Empty body"` or `"No valid records in payload"` |
| `401` | Missing/wrong bearer token |
| `500` | `"Failed to ingest usage"` or `USAGE_INGEST_TOKEN` not configured |

Source: `services/console/src/app/internal/usage/ingest/route.ts`, `services/console/src/server/api/services/usage-ingest.service.ts`.

---

## Pages

### `POST /api/pages/create`
Create a new project page. Inserts into `sites` + `pages` tables. Subdomain is auto-unique (nanoid suffix appended if taken).

**Request body:**
```json
{ "project_name": "my-site" }
```
Validation: `project_name` must be ≥ 3 characters.

**Response `200`:**
```json
{
  "id": "<page_uuid>",
  "site_id": "<site_uuid>",
  "tenant_id": "HjwPwRE2...",
  "tenant_name": "Example Tenant",
  "plan": "free",
  "domain": "my-site.localhost",
  "project_name": "my-site",
  "request": 0,
  "request_limit": 100000,
  "bandwidth_usage": 0,
  "bandwidth_limit": 2147483648,
  "createdAt": "2026-07-20T12:00:00.000Z"
}
```

---

### `GET /api/pages`
List all pages for the authenticated tenant.

**Response `200`:** Array of page objects (same shape as create response).

---

### `DELETE /api/pages/:id`
Delete a page. Removes MinIO objects, deactivates the site in DB, invalidates Redis cache.

| Status | Meaning |
|--------|---------|
| `200` | `{ success: true }` |
| `403` | Page belongs to another tenant |
| `404` | Page not found |

---

### `GET /api/pages/usage/:domain`
Get live + DB-persisted request and bandwidth usage for a domain.

**Response `200`:**
```json
{
  "requests": { "used": 1234, "limit": 100000 },
  "bandwidth": { "used_gb": "0.001234", "limit": "1GB" }
}
```

> Usage = DB value + live Redis counter (not yet flushed to DB).

---

## Deploy (content-addressed)

Client-side file deploy: **prepare → presign → commit**. Files are validated via magic bytes, stored as SHA256 blobs (`blobs/{hash}`), and assembled into the live prefix from `blob_tree_entries`.

### `POST /api/deploy/prepare`
Validate the file manifest, check which blobs already exist, issue a 10-minute deployment token (Redis DB3: `deploy:token:{token}`), and take the per-page deployment lock (`deploy:lock:{pageId}`, same TTL). A second prepare/commit/rollback for the same page returns **409** until the lock is released or expires.

**Request body:**
```json
{
  "pageId": "<page_uuid or project_name>",
  "files": [
    {
      "path": "index.html",
      "hash": "<sha256 hex>",
      "size": 1234,
      "magicBytes": "<base64 of first 16 bytes>"
    }
  ]
}
```

| Field | Notes |
|-------|-------|
| `pageId` | Page UUID **or** `project_name` |
| `files[].path` | Relative POSIX path (no `..`, no leading `/`) |
| `files[].hash` | Lowercase SHA256 hex |
| `files[].size` | Bytes; per-file max 50 MB; total max 250 MB |
| `files[].magicBytes` | Base64 of the first 16 bytes (extension + MIME checks) |

**Response `200`:**
```json
{
  "deploymentToken": "<hex>",
  "expiresIn": 600,
  "uploadRequired": [
    { "path": "index.html", "hash": "...", "size": 1234 }
  ],
  "filesReused": 2,
  "filesToUpload": 1,
  "summary": {
    "totalFiles": 3,
    "totalSize": 1234567,
    "totalSizeHuman": "1.18 MB",
    "uploadSize": 500000,
    "uploadSizeHuman": "488.28 KB",
    "reusedSize": 734567
  }
}
```

Blocked: `.env`, executables, archives (zip/tar/gz/…), and MIME/extension mismatches.

**Response `409`:** `{ "error": "A deployment is already in progress for this page" }` — another prepare, commit, or rollback holds `deploy:lock:{pageId}`.

---

### `POST /api/deploy/presign`
Return MinIO presigned PUT URLs for blob hashes that still need uploading.

**Request body:**
```json
{
  "deploymentToken": "<token from prepare>",
  "hashes": ["<sha256 hex>", "..."]
}
```

**Response `200`:**
```json
{
  "urls": [
    { "hash": "...", "url": "https://...", "method": "PUT" }
  ]
}
```

Upload each object to the presigned URL with the raw file body (object key: `blobs/{hash}`). Hashes already in the `blobs` table are omitted.

---

### `POST /api/deploy/commit`
Refreshes the per-page deployment lock (same holder as the prepare token), load blobs, expand Brotli/Gzip/WebP variants, write `blob_tree_entries`, generate + persist the deployment manifest (MinIO `manifests/{deploymentId}.json` + Redis `manifest:{deploymentId}`, validated before activation), refuse activation if a newer deployment version already exists, activate deployment, set `active_deployment:{site_id}`, `INCR site_version:{site_id}`, invalidate `site:{subdomain}`, fire-and-forget GC, consume the token, and release the lock. Request timeout: **5 minutes**.

No MinIO `tenant/` materialization — Caddy resolves subdomain → site_id → active deployment → manifest → `blobs/{hash}`.

**Request body:**
```json
{ "deploymentToken": "<token from prepare>" }
```

**Response `200`:**
```json
{
  "success": true,
  "deployment": {
    "id": "<uuid>",
    "page_id": "<uuid>",
    "site_id": "<uuid>",
    "version": 1,
    "is_active": true,
    "source": "upload",
    "file_count": 3,
    "filesDeployed": 1,
    "filesReused": 2,
    "created_at": "2026-07-23T12:00:00.000Z"
  },
  "filesDeployed": 1,
  "filesReused": 2,
  "summary": {
    "totalFiles": 3,
    "totalSize": 1234567,
    "totalSizeHuman": "1.18 MB",
    "filesCompressed": 2,
    "sizeReduced": 400000,
    "sizeReducedHuman": "390.63 KB",
    "sizeReducedPercent": 45.5,
    "imagesOptimized": 1,
    "imageOriginalSize": 500000,
    "imageOptimizedSize": 120000,
    "imageSizeReduced": 380000,
    "imageSizeReducedHuman": "371.09 KB",
    "imageSizeReducedPercent": 76.0,
    "deployedFiles": 8,
    "compressedVariants": 4,
    "webpVariants": 1
  }
}
```

Compression/WebP savings are computed at commit (after blobs are available). `sizeReduced` uses the best of Brotli/Gzip per text file; `imageSizeReduced` is original − WebP.

**Response `409`:** concurrent deployment in progress, lock lost before activation, or this deploy is stale (a newer version was committed after prepare).

| Status | Meaning |
|--------|---------|
| `200` | Deploy live |
| `400` | Invalid/expired token, validation failure, or missing blob object |
| `403` | Tenant does not own the page/token |
| `404` | Page not found |

---

## Builds — REMOVED

Cloud builds and their `/api/builds` endpoints have been **removed** (BullMQ
workers and the Docker build environment are gone). **CLI deploy is the only
deploy path** — see `POST /api/deploy/prepare|presign|commit` above. The
`builds` / `build_failures` tables remain in the schema as unused leftovers.

---

## Deployments & Rollbacks

### `GET /api/deployments/page/:pageId`
List all deployment versions for a **page** UUID (not a deployment UUID), newest first. Only one has `is_active: true`. Filtered by JWT `tenant_id` — wrong tenant returns `[]`. Retention steady state: ≤ 11 rows (1 active + 10 inactive).

**Response `200`:**
```json
[
  {
    "id": "<uuid>",
    "page_id": "<uuid>",
    "site_id": "<uuid>",
    "tenant_id": "...",
    "build_id": "<uuid or null>",
    "version": 2,
    "is_active": true,
    "source": "build",
    "file_count": 10,
    "filesDeployed": 3,
    "filesReused": 7,
    "created_at": "2026-07-20T12:00:00Z"
  },
  {
    "id": "<uuid>",
    "version": 1,
    "is_active": false,
    "source": "upload",
    "file_count": 5,
    "filesDeployed": 5,
    "filesReused": 0
  }
]
```

---

### `POST /api/deployments/:deploymentId/rollback`
Roll back to a previous deployment using its `blob_tree_entries` (blob-direct; no MinIO live copy).

**Workflow:**
1. Load target deployment’s blob tree (tenant-scoped)
2. `generateAndPersistManifest(deploymentId)` — validates/reuses the immutable manifest (throws on failure → no activation)
3. Set `is_active = true` on target; deactivate others
4. `setActiveDeploymentCache` + `cacheManifestInRedis` + `INCR site_version:{site_id}`
5. Invalidate Redis `site:{subdomain}`
6. Fire-and-forget `runDeploymentGC` (retention: 10 inactive)

**Response `200`:**
```json
{
  "success": true,
  "message": "Rollback successful",
  "deployment": { "...": "deployment row with is_active: true" }
}
```

| Status | Meaning |
|--------|---------|
| `200` | Rollback complete |
| `400` | Deployment has no blob tree |
| `404` | Deployment not found or belongs to another tenant |
| `500` | DB / Redis error |

---

## Error Response Shape

All error responses follow:
```json
{ "error": "Human-readable message" }
```

---

## Common HTTP Status Codes Used

| Code | Meaning |
|------|---------|
| `200` | Success |
| `201` | Created (builds) |
| `400` | Validation failed |
| `401` | Missing/invalid JWT |
| `403` | Tenant does not own resource |
| `404` | Resource not found |
| `500` | Unexpected server error |
