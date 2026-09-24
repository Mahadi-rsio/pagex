# Caddy static_s3 Plugin

`static_s3` is a middleware plugin for Caddy v2 that serves static files directly from AWS S3 or any S3-compatible storage (like MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, or Google Cloud Storage).

It is designed for production efficiency, security, and scalability, featuring built-in streaming, caching, range requests, SPA routing, **multi-tenant blob-direct serving**, and support for AWS credentials chains.

---

## Key Features

- **Multi-Tenant Blob-Direct Serving:** Route `tenant-a.example.com` → resolve `site_id` via LRU/PostgreSQL → resolve the active deployment's manifest (MinIO `manifests/{deploymentID}.json`, cached in LRU) → stream `blobs/{sha256}` from MinIO. Zero per-tenant Caddy config. No Redis.
- **Pre-compressed & WebP variants:** Automatically selects `.br`, `.gz`, or `.webp` variants from the path map based on `Accept-Encoding` / `Accept`.
- **Universal S3 Compatibility:** Works with any S3-compliant storage by configuring custom endpoints and region settings.
- **Memory-Efficient Streaming:** Streams files directly from S3 to the client. Never loads large files entirely into Caddy's memory.
- **High-Performance Caching:** Thread-safe LRU cache (L1) with PostgreSQL as the fallback (L2). No Redis:
  - Path resolution cache: `{deploymentID}:{path}:{encoding}` → blob hash
  - Negative cache: `{deploymentID}:{path}:404` (1 minute TTL)
  - File content cache: `{deploymentID}:{path}:{encoding}:body`
  - Active-deployment / site-id / manifest lookups cached in LRU (see tables below)
  - Cache keys are deployment-scoped so a new deploy makes old entries unreachable without a prefix scan
- **Browser Cache Headers:** Sets `Cache-Control` by file type; `Vary: Accept-Encoding` when serving br/gz variants.
- **Standard Range Requests:** Passes `Range` through to MinIO on `blobs/{hash}` unchanged.
- **Ambient Credentials support:** Access keys are optional; falls back to the standard AWS credentials chain (IAM Roles, EKS/ECS/EC2, env vars).
- **Advanced SPA Routing:** Falls back to `index.html` when no path candidate matches, with configurable extension exclusions.

---

## Configuration Reference

Add the `static_s3` directive inside your site block.

```caddy
:8080 {
    # Order the static_s3 directive relative to other handlers (usually before respond/reverse_proxy)
    route {
        static_s3 {
            # --- Connection / Provider Settings ---
            # Bucket name (Required)
            bucket "my-bucket"
            
             # S3 endpoint. Omit for standard AWS S3. (Optional)
             # IMPORTANT: Must include scheme (http:// or https://)
             # The Go AWS SDK v2 uses url.Parse() and requires a valid URL scheme
             endpoint "https://localhost:9000"
            
            # AWS Region. Defaults to "us-east-1" or "S3_REGION" environment variable. (Optional)
            region "us-east-1"
            
            # Static credentials. Omit to use IAM roles or ambient env vars. (Optional)
            access_key "my-access-key"
            secret_key "my-secret-key"
            
            # Use path-style urls (e.g., host/bucket/key) instead of virtual host (bucket.host/key).
            # Default: true (for backward compatibility and MinIO compatibility)
            use_path_style true

            # --- Multi-Tenant Settings ---
            # Base domain for subdomain extraction (enables multi-tenant mode). (Optional)
            # e.g. "example.com" → extracts "tenant-a" from "tenant-a.example.com"
            base_domain "example.com"
            
            # PostgreSQL DSN for site_id and deployment lookups. Falls back to DATABASE_URL. (Optional)
            db_dsn "postgres://user:pass@localhost:5432/mydb?sslmode=disable"

            # --- Routing & Paths ---
            # Sub-folder prefix inside the S3 bucket. (Optional)
            # Only used in single-tenant mode (prepended to the request path).
            # Multi-tenant mode always serves blobs/{hash} — prefix is ignored.
            prefix "public/"
            
            # SPA fallback file. Default: "index.html". Use "none" to disable. (Optional)
            fallback "index.html"
            
            # Extensions that should bypass SPA fallback and return a 404 directly. (Optional)
            fallback_except png jpg jpeg gif ico css js svg webp json xml

            # --- Cache Settings ---
            # TTL for cache entries (e.g., 5m, 1h, 24h). Default: 0 (caching disabled). (Optional)
            cache_ttl 5m
            
            # Max capacity of the LRU cache (number of entries). Default: 1000. (Optional)
            cache_size 1000
            
            # Max size of individual files to cache their body content in memory. (Optional)
            # Supports human-readable formats (e.g., 512KiB, 2MB).
            # If a file is larger than this, only its metadata is cached.
            max_cache_size 512KiB

            # --- Bandwidth Optimization (S3 Redirection) ---
            # Redirect the client directly to the S3 bucket URL to bypass VPS network bandwidth. (Optional)
            # Default: false. In multi-tenant mode redirects to blobs/{hash}.
            redirect_to_s3 true

            # Generate a temporary pre-signed URL for redirects to keep private buckets secure. (Optional)
            # Default: false (requires redirect_to_s3 to be true)
            presign_redirect true

            # Expiry time for pre-signed redirect URLs (e.g., 10m, 1h). Default: 15m. (Optional)
            presign_lifetime 15m
        }
    }
}
```

---

## Multi-Tenant Mode

When `base_domain` is set, the plugin switches into **multi-tenant blob-direct mode**. Subdomains resolve to a `site_id`; file paths resolve through the active deployment's **manifest** (a path→sha256 map) to content-addressed blobs. The runtime never reads `blob_tree_entries` from PostgreSQL.

### How a request is handled

```
tenant-a.example.com/about
        │
        ▼
  1. Extract subdomain → "tenant-a"
        │
        ▼
  2. Resolve site_id:
       LRU "subdomain:{site_id}:__site__" → hit
       miss → PostgreSQL lookup → cache (TTL 5 min)
       NOT_FOUND → negative-cache 10s → 404
        │
        ▼
  3. Resolve active deployment:
       LRU "subdomain:{deploymentID}:__active__" → hit
       miss → PostgreSQL SELECT ... WHERE is_active AND
             manifest_key IS NOT NULL → cache
             (deployments without a valid manifest are never served)
        │
        ▼
  4. Load manifest:
       LRU "manifest:{deployment_id}" (TTL 1h) → hit
       miss → single-flight coalesced load:
              MinIO GET "manifests/{deployment_id}.json"
              missing/corrupt manifest → negative-cache 10s → 500
        │
        ▼
  5. Resolve path candidates:
       /about → ["about/index.html", "about.html", "about"]
        │
        ▼
  6. For each candidate, pick best variant from manifest.files:
       Accept-Encoding: br   → try "{candidate}.br", else "{candidate}"
       Accept-Encoding: gzip → try "{candidate}.gz", else "{candidate}"
       Accept: image/webp    → try "{candidate}.webp" (image paths), else raw
       no encoding           → "{candidate}"
       first hit → proceed; all miss → next candidate
        │
        ▼
  7. All candidates miss → SPA fallback:
       path has fallback_except extension → 404
       otherwise → "index.html" (same Accept-Encoding logic)
                   miss → 404
        │
        ▼
  8. Stream from MinIO: blobs/{blob_hash}
```

### PostgreSQL schema

```sql
CREATE TABLE sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subdomain   TEXT NOT NULL UNIQUE,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_sites_subdomain ON sites(subdomain);

-- Active deployment (runtime resolves this to find its manifest)
CREATE TABLE deployments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id      UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    is_active    BOOLEAN NOT NULL DEFAULT false,
    manifest_key TEXT,           -- NOT NULL for anything Caddy will serve
    created_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE blob_tree_entries (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deployment_id UUID NOT NULL REFERENCES deployments(id) ON DELETE CASCADE,
    path          TEXT NOT NULL,   -- e.g. "about/index.html", "about/index.html.br"
    blob_hash     TEXT NOT NULL    -- SHA256 of blob content
);
```

### S3 / MinIO layout

All tenants share one content-addressed blob store. There is no `tenant/{site_id}/` prefix.

```
my-bucket/
├── blobs/
│   ├── a1b2c3d4e5f6...   ← SHA256 of file content
│   ├── 9f8e7d6c5b4a...
│   └── ...
└── manifests/
    └── {deployment_id}.json   ← path→sha256 map (+ .br/.gz/.webp variants)
```

The manifest is generated by the API at commit/rollback time (`generateAndPersistManifest`) and stored **before** the deployment is activated. Caddy loads it through its LRU cache → MinIO (single-flight); it is never rebuilt from PostgreSQL at runtime.

### Cache keys (LRU only — no Redis)

| Scenario | LRU key | Value | TTL |
|---|---|---|---|
| Tenant found | `subdomain:{site_id}:__site__` | site UUID | 5 min |
| Tenant not found | `subdomain:__site__:404` | `NOT_FOUND` | 10 s |
| Active deployment | `subdomain:{deployment_id}:__active__` | deployment UUID | 60 s |
| Deployment manifest | `manifest:{deployment_id}` | JSON path→hash map | 1 h |
| Manifest load error | `manifest:{deployment_id}:error` | `NOT_FOUND` | 10 s |

Path lookups read from the manifest `files` map in memory — no Redis hash, no `HGETALL`.

### LRU cache (multi-tenant)

| Key | Value | TTL |
|---|---|---|
| `subdomain:{site_id}:__site__` | site UUID | 5 min |
| `subdomain:{deployment_id}:__active__` | deployment UUID | 60 s |
| `manifest:{deployment_id}` | parsed manifest | 1 h |
| `{deployment_id}:{path}:{br\|gz\|webp\|raw}` | blob hash | `cache_ttl` |
| `{deployment_id}:{path}:404` | `NOT_FOUND` | 1 min |
| `{deployment_id}:{path}:{encoding}:body` | file body and/or metadata | `cache_ttl` |

On LRU path hit: skip all DB calls, go straight to MinIO (or serve cached body).

Path and body cache keys are deployment-scoped (they embed the active `deployment_id`), so a new deploy makes old entries unreachable without scanning the LRU. The site-id and active-deployment lookups are short-lived, so a deploy is picked up within their TTL.

### Browser Cache-Control

| File | Cache-Control |
|---|---|
| `.html` | `no-cache` |
| `.js`, `.css`, `.woff`, `.woff2`, `.ttf`, `.otf`, `.mjs`, `.wasm` | `max-age=31536000, immutable` |
| `.webp`, `.png`, `.jpg`, `.gif`, `.svg`, `.avif`, `.webm`, `.mp3`, `.mp4`, `.ico`, `.pdf` | `max-age=604800` |
| everything else | `max-age=3600` |

Content-Type is inferred from the original file path (`.br`/`.gz` stripped). Never from the blob key. `Vary: Accept-Encoding` is set when serving br/gz variants; `Vary: Accept` is set when a `.webp` variant was negotiated via the `Accept` header.

### Cache invalidation on deploy

```
Deploy / rollback succeeds
      ↓
New deployment becomes active (PostgreSQL is_active)
      ↓
Next request hits Caddy:
  active-deployment LRU (TTL 60s) → miss or stale
  → PostgreSQL lookup → new deployment_id
  → manifest for the new deployment is fetched from MinIO
  → path/body LRU keys are deployment-scoped → old entries unreachable
  → naturally evicted by LRU capacity or TTL
```

There is no push-based invalidation (no Redis, no Admin API). Deployment-scoped
path keys plus the short active-deployment/site TTLs are the only mechanisms —
a deploy is picked up within ~60s with no stale path served.

### Managing tenants

```bash
# Add a new tenant
psql -c "INSERT INTO sites (subdomain) VALUES ('tenant-a');"

# Disable a tenant immediately
psql -c "UPDATE sites SET active=false WHERE subdomain='tenant-a';"

# After deploy / rollback the backend flips deployments.is_active and the
# active-deployment LRU entry expires within 60s.
```

### Environment variables (multi-tenant)

| Variable | Caddyfile equivalent | Description |
|---|---|---|
| `BASE_DOMAIN` | `base_domain` | Base domain for subdomain extraction |
| `DATABASE_URL` | `db_dsn` | PostgreSQL connection string |
| `S3_ACCESS_KEY` | `access_key` | S3 access key |
| `S3_SECRET_KEY` | `secret_key` | S3 secret key |

### Full multi-tenant Caddyfile example

```caddy
{
    order static_s3 before respond
}

*.example.com {
    static_s3 {
        endpoint        https://s3.dianahost.com
        bucket          example-sites
        access_key      {env.S3_ACCESS_KEY}
        secret_key      {env.S3_SECRET_KEY}
        use_path_style  true

        base_domain     example.com
        db_dsn          {env.DATABASE_URL}

        cache_ttl       10m
        cache_size      2000
        max_cache_size  5MB
        fallback_except png css js svg ico woff woff2 ttf map
    }
}
```

---

## Single-Tenant Mode

When `base_domain` is not set, the plugin serves objects by request path (optionally under `prefix`). SPA fallback, LRU content cache, range requests, and S3 redirect options work as before.

---

## S3 Redirection (Bandwidth Optimization / BDIX)

For platforms with high traffic or hosting massive static media files, routing all traffic through your VPS can consume excessive bandwidth and cause latency.

By enabling `redirect_to_s3 true`, Caddy will:
1. Resolve the blob (multi-tenant) or object key (single-tenant) via cache / HeadObject.
2. Catch missing files and run SPA fallback where applicable.
3. Redirect the client's browser (HTTP `307 Temporary Redirect`) directly to the S3 provider (`blobs/{hash}` in multi-tenant mode).

This shifts **100% of the download bandwidth** to your S3 provider.

### Private Buckets Security
If your S3 bucket is private, enable `presign_redirect true`. Caddy will generate a temporary pre-signed S3 URL on the fly (locally, using your access/secret keys with no S3 API network calls) and redirect the client to that secure URL.

---

## Provider Examples

### 1. AWS S3 (Using Ambient IAM Roles)
When deploying to AWS (EKS, ECS, EC2), you do not need to hardcode keys:
```caddy
static_s3 {
    bucket "my-production-bucket"
    region "us-west-2"
    use_path_style false # AWS standard
    cache_ttl 10m
    max_cache_size 1MB
}
```

### 2. Cloudflare R2
Cloudflare R2 uses virtual host style endpoints by default, and region is always `auto`:
```caddy
static_s3 {
    bucket "my-r2-bucket"
    endpoint "https://<account-id>.r2.cloudflarestorage.com"
    region "auto"
    access_key "r2-access-key-id"
    secret_key "r2-secret-access-key"
    use_path_style false
    cache_ttl 1h
    max_cache_size 512KiB
}
```

### 3. MinIO (Local Development)
```caddy
static_s3 {
    bucket "dev-bucket"
    # IMPORTANT: Always include scheme (http:// or https://)
    endpoint "http://localhost:9000"
    access_key "admin"
    secret_key "StrongPassword123"
    use_path_style true
    cache_ttl 10s # Short TTL for dev
}
```

> **Note:** The `endpoint` must always include the scheme (`http://` or `https://`). The Go AWS SDK v2 uses `url.Parse()` on this value, and without a scheme, the hostname is treated as a URL path, producing invalid S3 request URLs.

---

## Project Structure

```
.
├── Caddyfile          # Development Caddy configuration file
├── go.mod             # Go module file
├── go.sum             # Go dependencies checksum file
├── src/
│   ├── cache.go       # LRU cache implementation with TTL
│   ├── cache_test.go  # LRU cache unit tests
│   ├── handler.go     # Core middleware, blob resolution, multi-tenant routing, streaming, access-log fields
│   ├── plugin.go      # Caddy registration, configuration parser, PostgreSQL setup
│   ├── plugin_test.go # Plugin & parser unit tests
│   ├── manifest.go    # Deployment manifest load (LRU → MinIO, single-flight)
│   └── sql_helpers.go # Internal sql.ErrNoRows bridge
└── README.md          # Project documentation
```

Usage metrics are not tracked in-process; Caddy emits JSON access logs (with
`site_id` / `deployment_id` / `cache_hit` via `ExtraLogFields`) that Vector
aggregates and posts to the API. See `vector/README.md`.

---

## How to Build

Use [xcaddy](https://github.com/caddyserver/xcaddy) to build Caddy with this plugin included.

### Installing xcaddy
```bash
go install github.com/caddyserver/xcaddy/cmd/xcaddy@latest
```

### Building Caddy with the Plugin
```bash
xcaddy build --with github.com/Mahadi-rsio/cdx_s3=. --output ./caddy
```

### Verify the plugin is embedded
```bash
./caddy list-modules | grep static_s3
# http.handlers.static_s3
```

---

## Running Tests

Run the unit tests using `go test`:
```bash
go test -v ./...
```
