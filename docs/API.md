# Cloudisy — Complete API Reference

> All endpoints are prefixed with the server root (default: `http://localhost:3000`).
> All protected endpoints require: `Authorization: Bearer <JWT>`
> The JWT is issued by `https://auth.cloudisy.com`. The payload must contain `id` (tenant ID) and `name` (tenant name).

---

## Health

### `GET /health`
No auth required.

**Response `200`:**
```json
{ "message": "ok" }
```

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
  "tenant_name": "cloudisy",
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

## Uploads

### `POST /upload/:pageIdOrName`
Upload a ZIP file to deploy. Replaces live files after snapshotting.

- `:pageIdOrName` can be the page UUID **or** the `project_name`.
- Form field name: `file`
- Max file size: 250 MB (`MAX_FILE_SIZE`)
- Content-Type: `multipart/form-data`

**Workflow:**
1. Multer saves ZIP to `temp_zips/`
2. Enqueues a BullMQ job on `UPLOAD_QUEUE`
3. Upload worker: snapshot → delete old live → extract ZIP → upload to MinIO → activate deployment

**Response `200`:**
```json
{
  "success": true,
  "message": "File queued for processing",
  "jobId": "1"
}
```

---

## Builds

### `POST /api/builds`
Trigger a cloud build from a git repository.

**Request body:**
```json
{
  "pageId": "<page_uuid>",
  "repoUrl": "https://github.com/user/repo",
  "gitProvider": "github",
  "gitToken": "ghp_...",
  "framework": "vite",
  "buildCommand": "pnpm build",
  "outputDir": "dist",
  "envVars": { "VITE_API_URL": "https://api.example.com" }
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `pageId` | ✅ | UUID of an existing page |
| `repoUrl` | ✅ | Must be a valid HTTPS URL |
| `gitProvider` | ✅ | `"github"` or `"gitlab"` |
| `gitToken` | ✅ | Personal access token for private repos |
| `framework` | ✅ | Any string (vite, next, etc.) |
| `buildCommand` | ❌ | Defaults to `"pnpm build"` |
| `outputDir` | ❌ | Auto-detected if omitted (`.next`, `dist`, `out`, `build`, `public`) |
| `envVars` | ❌ | Key-value map injected into build container |

**Response `201`:** Build row:
```json
{
  "id": "<build_uuid>",
  "page_id": "<page_uuid>",
  "tenant_id": "...",
  "job_id": "1",
  "status": "queued",
  "repo_url": "...",
  "git_provider": "github",
  "framework": "vite",
  "build_command": "pnpm build",
  "output_dir": "dist",
  "error": null,
  "triggered_by": "cli",
  "created_at": "2026-07-20T12:00:00Z",
  "completed_at": null
}
```

---

### `GET /api/builds/:buildId/logs`
**Server-Sent Events** stream of build logs. Connect with `fetch` + stream reader or `EventSource`.

> ⚠️ Route must be defined **before** `GET /api/builds/:buildId` to avoid collision.

**SSE event shape:**
```
data: {"type":"log","message":"Step 1: Cloning repository..."}

data: {"type":"progress","value":35}

data: {"type":"status","status":"active"}

data: {"type":"log","message":"[Stats] RAM: 350MiB / 1GiB | Net I/O: 46.8MB / 317kB"}

data: {"type":"log","message":"[Stats] Total Build Duration: 28.84s"}

data: {"type":"done","status":"completed","durationMs":28843}
```

| Event type | Payload fields | Description |
|------------|---------------|-------------|
| `log` | `message: string` | Single log line. `[Stats]` prefix = resource metric |
| `progress` | `value: number` | 0–100% |
| `status` | `status: string` | BullMQ job state |
| `done` | `status`, `error?`, `durationMs?` | Terminal — stream ends |
| `error` | `message: string` | Stream-level error |

**curl example:**
```bash
curl -N -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/builds/<buildId>/logs
```

---

### `GET /api/builds/:buildId`
Get a single build record.

**Response `200`:** Build row (same shape as trigger response, with `completed_at` and `error` populated).

---

### `GET /api/builds/page/:pageId`
List the last 20 builds for a page, newest first.

**Response `200`:** Array of build rows.

---

## Deployments & Rollbacks

### `GET /api/deployments/page/:pageId`
List all deployment versions for a page, newest first. Only one will have `is_active: true`.

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
    "snapshot_prefix": "cloudisy-snapshots/<site_id>/v2/",
    "is_active": true,
    "source": "build",
    "file_count": 10,
    "created_at": "2026-07-20T12:00:00Z"
  },
  {
    "id": "<uuid>",
    "version": 1,
    "is_active": false,
    "source": "upload",
    ...
  }
]
```

---

### `POST /api/deployments/:deploymentId/rollback`
Roll back to any previous deployment snapshot. Site goes live immediately.

**Workflow:**
1. Copy current live → snapshot of active version (backup)
2. Delete live files
3. Copy target snapshot → live prefix
4. Set `is_active = true` on target; set all others to `false`

**Response `200`:**
```json
{
  "success": true,
  "message": "Rollback successful",
  "deployment": { ...deployment row with is_active: true... }
}
```

| Status | Meaning |
|--------|---------|
| `200` | Rollback complete |
| `404` | Deployment not found or belongs to another tenant |
| `500` | MinIO or DB error |

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
