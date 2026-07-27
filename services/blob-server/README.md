# Caddy static_s3 Plugin

`static_s3` is a middleware plugin for Caddy v2 that serves static files directly from AWS S3 or any S3-compatible storage (like MinIO, Cloudflare R2, DigitalOcean Spaces, Backblaze B2, or Google Cloud Storage).

It is designed for production efficiency, security, and scalability, featuring built-in streaming, caching, range requests, SPA routing, **multi-tenant blob-direct serving**, and support for AWS credentials chains.

---

## Key Features

- **Multi-Tenant Blob-Direct Serving:** Route `tenant-a.cloudisy.com` → resolve `site_id` via Redis/PostgreSQL → look up the file in a Redis path map (`site_files:{site_id}`) → stream `blobs/{sha256}` from MinIO. Zero per-tenant Caddy config.
- **Pre-compressed & WebP variants:** Automatically selects `.br`, `.gz`, or `.webp` variants from the path map based on `Accept-Encoding` / `Accept`.
- **Universal S3 Compatibility:** Works with any S3-compliant storage by configuring custom endpoints and region settings.
- **Memory-Efficient Streaming:** Streams files directly from S3 to the client. Never loads large files entirely into Caddy's memory.
- **High-Performance Caching:** Thread-safe LRU cache with configurable TTL:
  - Path resolution cache: `{subdomain}:{version}:{path}:{encoding}` → blob hash (skips Redis on hit)
  - Negative cache: `{subdomain}:{version}:{path}:404` (1 minute TTL)
  - File content cache: `{subdomain}:{version}:{path}:{encoding}:body`
  - Version key: `{subdomain}:__version__` (from Redis `site_version:{site_id}`)
  - Instant deploy invalidation via version bump — old LRU entries become unreachable without a prefix scan
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
            # e.g. "cloudisy.com" → extracts "tenant-a" from "tenant-a.cloudisy.com"
            base_domain "cloudisy.com"
            
            # PostgreSQL DSN for site_id and blob-tree lookups. Falls back to DATABASE_URL. (Optional)
            db_dsn "postgres://user:pass@localhost:5432/mydb?sslmode=disable"
            
            # Redis URL for site:, site_version:, and site_files: keys. Falls back to REDIS_URL. (Optional)
            redis_url "redis://localhost:6379/0"

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

When `base_domain` is set, the plugin switches into **multi-tenant blob-direct mode**. Subdomains resolve to a `site_id`; file paths resolve through a Redis hash to content-addressed blobs.

### How a request is handled

```
tenant-a.cloudisy.com/about
        │
        ▼
  1. Extract subdomain → "tenant-a"
        │
        ▼
  2. Redis GET "site:tenant-a"
       hit  → site_id
       miss → evict LRU "{subdomain}:__version__"
             → PostgreSQL lookup → cache (TTL 5 min)
             NOT_FOUND → 404
        │
        ▼
  2b. Resolve deploy version:
       LRU "{subdomain}:__version__" → hit
       miss → Redis GET "site_version:{site_id}" (default "0")
             → cache in LRU with cache_ttl
        │
        ▼
  3. Resolve path candidates:
       /about → ["about/index.html", "about.html", "about"]
        │
        ▼
  4. For each candidate, pick best variant via HGET site_files:{site_id}:
       Accept-Encoding: br   → try "{candidate}.br", else "{candidate}"
       Accept-Encoding: gzip → try "{candidate}.gz", else "{candidate}"
       Accept: image/webp    → try "{candidate}.webp" (image paths), else raw
       no encoding           → "{candidate}"
       first hit → proceed; all miss → next candidate
        │
        ▼
  5. All candidates miss → SPA fallback:
       path has fallback_except extension → 404
       otherwise → HGET "index.html" (same Accept-Encoding logic)
                   miss → 404
        │
        ▼
  6. site_files:{site_id} key missing (TTL expired):
       SELECT path, blob_hash FROM blob_tree_entries
         JOIN deployments ON ... WHERE is_active AND site_id = $1
       Serve current request from PostgreSQL result immediately
       Rebuild Redis hash (DEL → HSET → EXPIRE 86400) in background
        │
        ▼
  7. Stream from MinIO: blobs/{blob_hash}
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

-- Active deployment + file tree (used when site_files Redis key expires)
CREATE TABLE deployments (
    id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id    UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    is_active  BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
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
└── blobs/
    ├── a1b2c3d4e5f6...   ← SHA256 of file content
    ├── 9f8e7d6c5b4a...
    └── ...
```

### Redis keys

| Scenario | Redis key | Value | TTL |
|---|---|---|---|
| Tenant found | `site:tenant-a` | site UUID | 5 min |
| Tenant not found | `site:ghost` | `NOT_FOUND` | 1 min |
| Deploy version | `site_version:{site_id}` | integer counter (string) | none (permanent) |
| File path map | `site_files:{site_id}` | Hash: field=`path` (incl. `.br`/`.gz`/`.webp`), value=`blob_hash` | 24 h (rebuilt from PG on miss) |

Path lookups use **HGET per candidate only** — never `HGETALL`.

`site_version:{site_id}` has no TTL. The backend should `INCR` it after every successful commit/rollback, and `DEL` it when the site is deleted.

### LRU cache (multi-tenant)

| Key | Value | TTL |
|---|---|---|
| `{subdomain}:__version__` | deploy version string | `cache_ttl` |
| `{subdomain}:{version}:{path}:{br\|gz\|webp\|raw}` | blob hash | `cache_ttl` |
| `{subdomain}:{version}:{path}:404` | `NOT_FOUND` | 1 min |
| `{subdomain}:{version}:{path}:{encoding}:body` | file body and/or metadata | `cache_ttl` |

On LRU path hit: skip all Redis calls, go straight to MinIO (or serve cached body).

The version key is **not** version-scoped. All other keys include the version so a deploy bump makes old entries unreachable without scanning the LRU.

### Browser Cache-Control

| File | Cache-Control |
|---|---|
| `.html` | `no-cache` |
| `.js`, `.css`, `.woff`, `.woff2` | `max-age=31536000, immutable` |
| `.webp`, `.png`, `.jpg`, `.gif`, `.svg` | `max-age=604800` |
| everything else | `max-age=3600` |

Content-Type is inferred from the original file path (`.br`/`.gz` stripped). Never from the blob key. `Vary: Accept-Encoding` is set when serving br/gz variants.

### Cache invalidation on deploy

```
Deploy / rollback succeeds
      ↓
Backend: INCR site_version:{site_id}  →  "8"
Backend: DEL site:{subdomain}
Backend: DEL site_files:{site_id}     (optional; rebuilt on miss)
      ↓
Next request hits Caddy:
  Redis GET site:mysite → miss
  → evict LRU "mysite:__version__" only
  → PostgreSQL lookup → site_id → cache site:mysite
  → Redis GET site_version:{site_id} → "8"
  → LRU store "mysite:__version__" = "8"
  → subsequent lookups use "mysite:8:..."
  → old "mysite:7:*" keys are never looked up again
  → naturally evicted by LRU capacity or TTL
```

No prefix scan, no Admin API — version scoping is the only invalidation mechanism.

### Managing tenants

```bash
# Add a new tenant
psql -c "INSERT INTO sites (subdomain) VALUES ('tenant-a');"

# Disable a tenant immediately
psql -c "UPDATE sites SET active=false WHERE subdomain='tenant-a';"
redis-cli DEL site:tenant-a

# After deploy / rollback (backend should do this)
redis-cli INCR site_version:{site_id}
redis-cli DEL site:tenant-a
redis-cli DEL site_files:{site_id}

# On site delete
redis-cli DEL site:tenant-a site_files:{site_id} site_version:{site_id}
```

### Environment variables (multi-tenant)

| Variable | Caddyfile equivalent | Description |
|---|---|---|
| `BASE_DOMAIN` | `base_domain` | Base domain for subdomain extraction |
| `DATABASE_URL` | `db_dsn` | PostgreSQL connection string |
| `REDIS_URL` | `redis_url` | Redis connection URL |
| `S3_ACCESS_KEY` | `access_key` | S3 access key |
| `S3_SECRET_KEY` | `secret_key` | S3 secret key |

### Full multi-tenant Caddyfile example

```caddy
{
    order static_s3 before respond
}

*.cloudisy.com {
    static_s3 {
        endpoint        https://s3.dianahost.com
        bucket          cloudisy-sites
        access_key      {env.S3_ACCESS_KEY}
        secret_key      {env.S3_SECRET_KEY}
        use_path_style  true

        base_domain     cloudisy.com
        db_dsn          {env.DATABASE_URL}
        redis_url       {env.REDIS_URL}

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
1. Resolve the blob (multi-tenant) or object key (single-tenant) via cache / Redis / HeadObject.
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
    endpoint "http://localhost:9000"
    access_key "admin"
    secret_key "StrongPassword123"
    use_path_style true
    cache_ttl 10s # Short TTL for dev
}
```

---

## Project Structure

```
.
├── Caddyfile          # Development Caddy configuration file
├── go.mod             # Go module file
├── go.sum             # Go dependencies checksum file
├── cache.go           # LRU cache implementation with TTL
├── cache_test.go      # LRU cache unit tests
├── handler.go         # Core middleware, blob resolution, multi-tenant routing, streaming
├── plugin.go          # Caddy registration, configuration parser, PostgreSQL & Redis setup
├── plugin_test.go     # Plugin & parser unit tests
├── analytics.go       # Per-site analytics middleware
├── sql_helpers.go     # Internal sql.ErrNoRows bridge
└── README.md          # Project documentation
```

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
