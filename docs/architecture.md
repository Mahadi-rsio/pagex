# Architecture Overview

This document provides a comprehensive overview of the PageX platform architecture, including system components, data flow, and design decisions.

## 🏗️ System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              PageX Platform                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                         Client Layer                                  │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │   │
│  │  │   Browser    │  │   CLI        │  │   API Client │  │   Mobile   │ │   │
│  │  │  (Users)     │  │  (Deploy)     │  │  (Integrations)│  │   Apps     │ │   │
│  │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────┬────┘ │   │
│  └─────────┼────────────────┼────────────────┼────────────────┼─────────┘   │
│            │                │                │                │              │
│            └────────────────┴────────────────┴────────────────┘              │
│                                  │                                         │
│                    ┌─────────────────────────────────────────────┐          │
│                    │            Edge Layer (Caddy)                   │          │
│                    │  ┌─────────────────────────────────────┐   │          │
│                    │  │           Blob Server (static_s3)        │   │          │
│                    │  │  - Multi-tenant routing                   │   │          │
│                    │  │  - Subdomain → Site ID resolution         │   │          │
│                    │  │  - Path → Blob hash resolution           │   │          │
│                    │  │  - Content-addressed blob serving        │   │          │
│                    │  │  - Automatic compression variants        │   │          │
│                    │  │  - High-performance caching               │   │          │
│                    │  │  - S3-compatible storage (MinIO)         │   │          │
│                    │  └─────────────────────────────────────┘   │          │
│                    └─────────────────────────────────────────────┘          │
│                                          │                                         │
│                    ┌─────────────────────────────────────────────┐          │
│                    │          Application Layer (Express)            │          │
│                    │  ┌─────────────────────────────────────┐   │          │
│                    │  │              API Service                   │   │          │
│                    │  │  - REST API endpoints                     │   │          │
│                    │  │  - Authentication (JWT)                   │   │          │
│                    │  │  - Site management                       │   │          │
│                    │  │  - Deployment management                  │   │          │
│                    │  │  - Build management                       │   │          │
│                    │  │  - Analytics tracking                     │   │          │
│                    │  └─────────────────────────────────────┘   │          │
│                    │                                              │          │
│                    │  ┌─────────────────────────────────────┐   │          │
│                    │  │            Console Service                 │   │          │
│                    │  │  - Next.js web interface                 │   │          │
│                    │  │  - User authentication (Better Auth)    │   │          │
│                    │  │  - Project management UI                 │   │          │
│                    │  │  - Deployment management UI              │   │          │
│                    │  │  - Analytics dashboard                    │   │          │
│                    │  └─────────────────────────────────────┘   │          │
│                    └─────────────────────────────────────────────┘          │
│                                          │                                         │
│                    ┌─────────────────────────────────────────────┐          │
│                    │            Data Layer                              │          │
│                    │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐ │          │
│                    │  │  PostgreSQL  │  │    Redis     │  │    MinIO     │ │          │
│                    │  │  (Primary DB)│  │  (Cache/Queue)│  │  (Storage)   │ │          │
│                    │  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘ │          │
│                    │         │                │                │        │          │
│                    │         └────────────────┴────────────────┴────────┘          │
│                    └─────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                      Background Processing                              │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │   │
│  │  │  Build Worker    │  │  GC Worker       │    │   │
│  │  │  (Cloud Builds)   │  │  (Garbage Collect)│    │   │
│  │  └─────────────────┘  └─────────────────┘    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

## 🔄 Request Flow

### Static Asset Request (Most Common)

```
Client Request
     │
     ▼
┌─────────────────────────────────────┐
│  Caddy (Blob Server)                  │
│  1. Extract subdomain from Host header│
│     e.g., "mysite.cloudisy.com" → "mysite"
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Redis Cache                         │
│  2. GET "site:mysite"                │
│     → site_id (cached for 5 min)     │
└─────────────────┬───────────────────┘
                  │
                  ▼ (cache miss)
┌─────────────────────────────────────┐
│  PostgreSQL                          │
│  3. SELECT id FROM sites             │
│     WHERE subdomain = 'mysite'        │
│     AND active = true                │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Redis Cache                         │
│  4. SET "site:mysite" site_id (TTL 5m)│
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Redis Cache                         │
│  5. GET "site_version:{site_id}"     │
│     → version (e.g., "5")            │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Caddy (Blob Server)                 │
│  6. Resolve active deployment        │
│     (L1 → Redis "active_deployment:  │
│     {site_id}" → PostgreSQL,         │
│     requires manifest_key)           │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Manifest (MinIO/Redis)              │
│  7. Load manifest:{deployment_id}    │
│     (L1 → coalesced → Redis → MinIO) │
│     files["{path}"] → blob_hash      │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  MinIO (S3-compatible)                │
│  8. GET "blobs/{blob_hash}"           │
│     → Stream file content             │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Caddy Response                       │
│  9. Stream to client with:            │
│     - Proper Content-Type             │
│     - Cache-Control headers           │
│     - Vary: Accept / Accept-Encoding  │
│     - Range request support           │
└─────────────────────────────────────┘
```

### API Request Flow

```
Client Request
     │
     ▼
┌─────────────────────────────────────┐
│  Caddy (Reverse Proxy)                 │
│  - Routes /api/* to API service       │
│  - Handles CORS                       │
│  - Load balancing (future)            │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  API Service (Express)               │
│  1. JWT Authentication               │
│     - Verify JWT signature            │
│     - Check token expiry              │
│     - Load user from database         │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Request Validation                   │
│  - Zod schema validation             │
│  - Business rule validation           │
│  - Rate limiting                     │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Controller                          │
│  - Parse request                    │
│  - Call service methods              │
│  - Format response                   │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Service Layer                        │
│  - Business logic                    │
│  - Database operations               │
│  - Cache operations                  │
│  - External API calls                │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Infrastructure Layer                 │
│  - PostgreSQL queries                │
│  - Redis operations                  │
│  - MinIO operations                  │
│  - Queue job creation                │
└─────────────────┬───────────────────┘
                  │
                  ▼
┌─────────────────────────────────────┐
│  Response                            │
│  - Format JSON response              │
│  - Set proper headers                │
│  - Handle errors                     │
└─────────────────────────────────────┘
```

## 🗃️ Data Model

### Entity Relationship Diagram

```
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│      User        │       │      Site        │       │     Page        │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK)          │       │ id (PK)          │       │ id (PK)          │
│ email            │       │ subdomain        │       │ siteId (FK)      │
│ passwordHash     │       │ active           │       │ name            │
│ name             │       │ createdAt        │       │ domain          │
│ createdAt        │◄──────┤ ownerId (FK)     │◄──────┤ createdAt       │
│ updatedAt        │       │ updatedAt        │       │ updatedAt       │
└─────────────────┘       └────────┬────────┘       └─────────────────┘
                                      │
                                      ▼
┌─────────────────┐       ┌─────────────────┐       ┌─────────────────┐
│   Deployment     │       │  BlobTreeEntry    │       │      Blob       │
├─────────────────┤       ├─────────────────┤       ├─────────────────┤
│ id (PK)          │       │ id (PK)          │       │ hash (PK)        │
│ siteId (FK)      │◄──────┤ deploymentId (FK)│       │ size            │
│ isActive         │       │ path            │       │ contentType     │
│ createdAt        │       │ blobHash (FK)   │◄──────┤ createdAt       │
│ filesDeployed   │       │ createdAt        │       └─────────────────┘
│ filesReused     │       └─────────────────┘
└─────────────────┘
      │
      ▼
┌─────────────────┐       ┌─────────────────┐
│     Build       │       │ SiteDailyStats   │
├─────────────────┤       ├─────────────────┤
│ id (PK)          │       │ id (PK)          │
│ pageId (FK)      │       │ siteId (FK)      │
│ status           │       │ date             │
│ repositoryUrl    │       │ requests         │
│ branch           │       │ bandwidth        │
│ commitHash       │       │ createdAt        │
│ logs             │       └─────────────────┘
│ createdAt        │
│ completedAt      │
└─────────────────┘
```

### Database Tables

#### Sites

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique site identifier |
| `subdomain` | TEXT UNIQUE | Site subdomain (e.g., "mysite") |
| `active` | BOOLEAN | Whether site is active |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

#### Pages

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique page identifier |
| `site_id` | UUID FK | Reference to site |
| `name` | TEXT | Page name |
| `domain` | TEXT | Custom domain (optional) |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `updated_at` | TIMESTAMPTZ | Last update timestamp |

#### Deployments

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique deployment identifier |
| `site_id` | UUID FK | Reference to site |
| `is_active` | BOOLEAN | Whether this is the active deployment |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `files_deployed` | INTEGER | Number of files deployed |
| `files_reused` | INTEGER | Number of files reused from cache |

#### Blob Tree Entries

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique entry identifier |
| `deployment_id` | UUID FK | Reference to deployment |
| `path` | TEXT | File path (e.g., "index.html", "index.html.br") |
| `blob_hash` | TEXT | SHA256 hash of blob content |

#### Blobs

| Column | Type | Description |
|--------|------|-------------|
| `hash` | TEXT PK | SHA256 hash of content |
| `size` | INTEGER | Size in bytes |
| `content_type` | TEXT | MIME type |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

#### Builds

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique build identifier |
| `page_id` | UUID FK | Reference to page |
| `status` | TEXT | Build status (queued, active, completed, failed) |
| `repository_url` | TEXT | Git repository URL |
| `branch` | TEXT | Git branch |
| `commit_hash` | TEXT | Git commit hash |
| `logs` | TEXT | Build logs |
| `created_at` | TIMESTAMPTZ | Creation timestamp |
| `completed_at` | TIMESTAMPTZ | Completion timestamp |

#### Site Daily Stats

| Column | Type | Description |
|--------|------|-------------|
| `id` | UUID PK | Unique stat identifier |
| `site_id` | UUID FK | Reference to site |
| `date` | DATE | Date of stats |
| `requests` | INTEGER | Number of requests |
| `bandwidth` | INTEGER | Bandwidth in bytes |
| `created_at` | TIMESTAMPTZ | Creation timestamp |

## 🔐 Authentication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        Authentication Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Client    │     │   Console   │     │    API      │        │
│  │ (Browser)   │     │  (Next.js)  │     │ (Express)   │        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘        │
│         │                  │                  │                │
│         │  1. Login Request │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  2. Authenticate  │                  │                │
│         │  (OAuth/Email)    │                  │                │
│         │                  │                  │                │
│         │  3. Create Session│                  │                │
│         │  (Better Auth)    │                  │                │
│         │                  │                  │                │
│         │  4. Set Cookie    │                  │                │
│         │<──────────────────│                  │                │
│         │                  │                  │                │
│         │  5. API Request   │                  │                │
│         │────────────────────────────────────>│                │
│         │                  │  6. Verify JWT    │                │
│         │                  │     (JWKS from   │                │
│         │                  │      console)    │                │
│         │                  │──────────────────>│                │
│         │                  │                  │                │
│         │  7. Response     │<──────────────────┤                │
│         │<─────────────────│                  │                │
│         │                  │                  │                │
└─────────────────────────────────────────────────────────────────┘
```

### JWT Verification

1. Client sends request with `Authorization: Bearer <token>` header
2. API service extracts JWT from header
3. API service fetches JWKS from console (`AUTH_JWKS_URL`)
4. API service verifies JWT signature using JWKS
5. API service checks token expiry
6. API service loads user from JWT claims
7. Request proceeds with authenticated user

## 📦 Deployment Flow

### CLI Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                       CLI Deployment Flow                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Client    │     │     API     │     │   MinIO     │        │
│  │   (CLI)     │     │ (Express)   │     │ (Storage)   │        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘        │
│         │                  │                  │                │
│         │  1. PREPARE      │                  │                │
│         │  - Validate      │                  │                │
│         │    manifest      │                  │                │
│         │  - Check limits  │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  2. Generate     │                  │                │
│         │  deploy token    │                  │                │
│         │<──────────────────│                  │                │
│         │                  │                  │                │
│         │  3. PRESIGN       │                  │                │
│         │  - Get upload    │                  │                │
│         │    URLs          │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  4. Upload files  │                  │                │
│         │────────────────────────────────────>│                │
│         │                  │  5. Store blobs   │                │
│         │                  │     (blobs/{hash})│                │
│         │                  │                  │                │
│         │  6. COMMIT        │                  │                │
│         │  - Expand        │                  │                │
│         │    variants      │                  │                │
│         │  - Build blob    │                  │                │
│         │    tree          │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  7. Activate      │                  │                │
│         │  deployment      │                  │                │
│         │<──────────────────│                  │                │
│         │                  │                  │                │
│         │  8. Invalidate    │                  │                │
│         │  cache           │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
└─────────────────────────────────────────────────────────────────┘
```

### Cloud Build Deployment

```
┌─────────────────────────────────────────────────────────────────┐
│                     Cloud Build Deployment Flow                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────┐     ┌─────────────┐     ┌─────────────┐        │
│  │   Client    │     │     API     │     │ Build Worker │        │
│  │ (Browser)   │     │ (Express)   │     │ (Container)  │        │
│  └──────┬──────┘     └──────┬──────┘     └──────┬──────┘        │
│         │                  │                  │                │
│         │  1. Trigger      │                  │                │
│         │  build           │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  2. Create       │                  │                │
│         │  build record    │                  │                │
│         │<──────────────────│                  │                │
│         │                  │                  │                │
│         │  3. Queue job    │                  │                │
│         │──────────────────>│                  │                │
│         │                  │                  │                │
│         │  4. Process job   │                  │                │
│         │                  │──────────────────>│                │
│         │                  │                  │                │
│         │  5. Clone repo   │                  │                │
│         │                  │  - Git clone      │                │
│         │                  │    repository     │                │
│         │                  │                  │                │
│         │  6. Build        │                  │                │
│         │                  │  - Docker build   │                │
│         │                  │    with memory    │                │
│         │                  │    limit          │                │
│         │                  │  - Stream logs    │                │
│         │  7. Deploy       │                  │                │
│         │                  │  - Deploy from    │                │
│         │                  │    output dir     │                │
│         │                  │  - Activate       │                │
│         │                  │    deployment     │                │
│         │  8. Complete     │<──────────────────│                │
│         │  build           │                  │                │
│         │<──────────────────│                  │                │
│         │                  │                  │                │
└─────────────────────────────────────────────────────────────────┘
```

## 🗑️ Garbage Collection

### Deployment GC

```
┌─────────────────────────────────────────────────────────────────┐
│                      Deployment GC Flow                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  Trigger: After commit or rollback                                    │
│                                                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  1. Select inactive deployments (oldest first)              │   │
│  │     - Keep 1 active + 10 inactive (DEPLOYMENT_RETENTION=10)  │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  2. Collect blob hashes from selected deployments           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  3. Cross-check with active deployments                     │   │
│  │     - Remove hashes still referenced by active deployments   │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  4. Delete orphaned blobs from MinIO                        │   │
│  │     - Batch delete (100 at a time)                          │   │
│  │     - Concurrency limit (10 concurrent)                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                              │                                         │
│                              ▼                                         │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │  5. Delete database records in transaction                 │   │
│  │     - blob_tree_entries                                           │   │
│  │     - deployments                                                │   │
│  │     - blobs                                                      │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

## 🎯 Design Decisions

### Content-Addressed Storage

**Decision:** Store all files as content-addressed blobs at `blobs/{sha256}`

**Rationale:**
- **Deduplication:** Identical files across sites share the same blob
- **Immutability:** Blobs never change, enabling reliable caching
- **Scalability:** No per-tenant storage overhead
- **Simplicity:** Single storage namespace for all tenants

**Implementation:**
- SHA256 hash of file content used as blob key
- Path-to-hash mapping stored in a per-deployment manifest (MinIO `manifests/{deploymentID}.json`, cached in Redis `manifest:{deploymentId}`)
- Blob tree entries stored in PostgreSQL for persistence/control-plane only

### Multi-Tenant Routing

**Decision:** Use subdomain-based routing with dynamic configuration

**Rationale:**
- **Zero Configuration:** No per-tenant Caddy configuration needed
- **Scalability:** Can handle thousands of tenants with single Caddy instance
- **Isolation:** Each tenant has isolated file namespace
- **Flexibility:** Easy to add new tenants

**Implementation:**
- Caddy plugin extracts subdomain from Host header
- Redis lookup maps subdomain to site_id
- PostgreSQL fallback for cache misses
- Path resolution through the active deployment's manifest

### Automatic Optimization

**Decision:** Automatically create compressed and optimized variants

**Rationale:**
- **Performance:** Better compression = faster page loads
- **Bandwidth:** Reduced bandwidth usage
- **Compatibility:** Support for all modern browsers
- **Transparency:** Automatic, no user configuration needed

**Implementation:**
- **Text files:** Create `.br` (Brotli) and `.gz` (Gzip) variants
- **Images:** Create `.webp` variants for PNG/JPEG/GIF
- **Serving:** Select best variant based on Accept-Encoding header
- **Storage:** Store variants as separate blobs with content-encoded hashes

### Instant Rollback

**Decision:** Use blob tree switching for instant rollbacks

**Rationale:**
- **Speed:** Rollback is just a database flag flip + cache invalidation
- **Reliability:** No file copying or MinIO operations needed
- **Atomicity:** Rollback is atomic - either fully rolled back or not
- **Consistency:** Uses same serving mechanism as regular deployments

**Implementation:**
- Each deployment has its own blob tree in PostgreSQL (control plane)
- Active deployment marked with `is_active = true`; manifest persisted before activation
- Rollback flips `is_active` flags between deployments
- Manifest for the target deployment is reused from `generateAndPersistManifest`; `site_version:{site_id}` is incremented so Caddy's version-scoped L1 cache points at the new active deployment
- Cache invalidation ensures clients get new content

### Background Processing

**Decision:** Use BullMQ for background job processing

**Rationale:**
- **Reliability:** Jobs persist in Redis, survive worker restarts
- **Scalability:** Multiple workers can process jobs in parallel
- **Monitoring:** Built-in job tracking and retry logic
- **Flexibility:** Support for delayed and recurring jobs

**Implementation:**
- **Analytics:** Blob-server flushes Redis usage counters to PostgreSQL `site_daily_stats`
- **Build Worker:** Processes cloud build jobs
- **Queue:** Jobs stored in Redis with priority and retry logic

### Deployment Safety (Production Hardening)

**Decision:** Add database-level invariants, atomic deployment activation, idempotency, and robust queue retry/DLQ

**Rationale:**
- **Correctness:** Prevent race conditions and data corruption at DB level
- **Reliability:** Ensure exactly-one-active-deployment, no stale overwrites
- **Observability:** DLQ captures failed builds with full context for debugging
- **Idempotency:** Safe retries without duplicate deployments

**Database Invariants (enforced by PostgreSQL):**
- `UNIQUE(page_id, version)` — no duplicate versions per page
- `UNIQUE(page_id) WHERE is_active = true` — exactly one active deployment per page (partial index)
- `UNIQUE(tenant_id, page_id, idempotency_key)` — scoped idempotency keys
- `CHECK builds.status IN ('queued','running','completed','failed','cancelled')`
- `CHECK deployments.status IN ('pending','active','failed','superseded')`
- `CHECK deployments.source IN ('build','upload')`
- `CHECK active deployments require manifest` — `is_active` → all manifest fields NOT NULL
- `FK deployments.build_id ON DELETE SET NULL` — build deletion doesn't orphan deployments

**Deployment State Machine:**
```
pending
  │
  ├──→ active (atomic DB transaction, manifest validated)
  │
  ├──→ failed (build/deploy error, NEVER becomes active)
  │
  └──→ superseded (newer deployment activated, or rollback to older)
```
- FAILED deployment can NEVER become ACTIVE (enforced by CHECK constraint)
- ACTIVE deployment MUST have finalized manifest (enforced by CHECK constraint)
- Previous ACTIVE deployment remains ACTIVE if new deployment fails (atomic transaction)

**Atomic Activation (PostgreSQL transaction):**
1. Mark new deployment `is_active: true, status: 'active'`
2. Mark previous active `is_active: false, status: 'superseded'`
3. **Redis updates ONLY after successful DB commit** — `setActiveDeploymentCache`, `cacheManifestInRedis`, `incrementSiteVersion`, `invalidateSiteCache`

**Idempotency Keys:**
- Scoped by `(tenant_id, page_id, idempotency_key)`
- `checkAndReserveIdempotencyKey()` — inserts if new, returns existing if duplicate
- `completeIdempotencyKey()` — sets `resource_id` after successful creation
- `failIdempotencyKey()` — deletes reservation on failure
- Request hash verification prevents silent corruption

**Queue Retry & DLQ:**
- 3 attempts with exponential backoff (10s base)
- Error classification: `classifyBuildError()` distinguishes retryable (network, MinIO, Redis, git) vs permanent (auth, validation, config) errors
- Permanent errors fail immediately → DLQ
- DLQ queue: `cloudisy-cloud-builds-dlq` with `FailedBuildJob` containing:
  - job_id, build_id, page_id, tenant_id, site_id
  - failureReason, failedAt, attemptsMade, errorType ('retryable'|'permanent')
  - Full context for debugging/alerting
- **No secrets** in DLQ — gitToken excluded
- DLQ worker logs full context for ops review

### Caching Strategy

**Decision:** Multi-level caching with smart invalidation

**Rationale:**
- **Performance:** Reduce database and storage load
- **Consistency:** Version-based cache keys ensure consistency
- **Efficiency:** LRU cache with configurable TTL and size
- **Simplicity:** Automatic invalidation on deployments

**Implementation:**
- **LRU Cache:** In-memory cache with TTL (Caddy plugin)
- **Redis Cache:** Site and path mappings (5 min TTL)
- **Browser Cache:** Proper Cache-Control headers
- **Invalidation:** Version bump on deploy makes old cache entries unreachable

## 📊 Performance Characteristics

### Throughput

| Component | Requests/Second | Notes |
|-----------|-----------------|-------|
| Blob Server | 10,000+ | Depends on hardware |
| API Server | 1,000+ | Express.js |
| Database | 5,000+ | PostgreSQL |
| Redis | 100,000+ | In-memory |
| MinIO | 5,000+ | S3-compatible |

### Latency

| Operation | Latency | Notes |
|-----------|---------|-------|
| Cache Hit | < 1ms | LRU cache |
| Redis Lookup | 1-5ms | Same network |
| Database Query | 5-20ms | Indexed queries |
| MinIO Get | 10-50ms | Depends on size |
| Full Request | 20-100ms | Cache hit |
| Full Request | 100-500ms | Cache miss |

### Storage Efficiency

| File Type | Original | Compressed | Savings |
|-----------|----------|------------|---------|
| HTML | 100% | 20-30% | 70-80% |
| CSS | 100% | 40-60% | 40-60% |
| JavaScript | 100% | 50-70% | 30-50% |
| JSON | 100% | 50-70% | 30-50% |
| PNG | 100% | 60-80% (WebP) | 20-40% |
| JPEG | 100% | 50-70% (WebP) | 30-50% |

## 🔒 Security Considerations

### Authentication

- **JWT:** Signed tokens with short expiry (24h)
- **JWKS:** Public keys fetched from console for verification
- **CORS:** Proper CORS headers for API endpoints
- **Rate Limiting:** Per-IP rate limiting on API endpoints

### Authorization

- **RBAC:** Role-based access control (future)
- **Ownership:** Users can only access their own sites
- **Scopes:** Fine-grained permission control (future)

### Data Protection

- **Encryption:** All data encrypted at rest (database, storage)
- **HTTPS:** All communications over HTTPS
- **Secrets:** Sensitive data stored in environment variables
- **Input Validation:** All inputs validated with Zod schemas

### Storage Security

- **Private Buckets:** MinIO buckets can be private
- **Pre-signed URLs:** Temporary URLs for private bucket access
- **Access Control:** S3 credentials with limited permissions

## 🚀 Scalability

### Horizontal Scaling

| Component | Scaling Strategy | Notes |
|-----------|------------------|-------|
| Blob Server | Multiple instances | Stateless, share MinIO |
| API Server | Multiple instances | Stateless, share DB/Redis |
| Console | Multiple instances | Stateless, share DB/Redis |
| Database | Read replicas | PostgreSQL |
| Redis | Cluster mode | Redis Cluster |
| MinIO | Distributed mode | MinIO Distributed |

### Vertical Scaling

| Component | Resource | Recommendation |
|-----------|----------|----------------|
| Blob Server | CPU | 2+ cores |
| Blob Server | Memory | 2GB+ |
| API Server | CPU | 2+ cores |
| API Server | Memory | 1GB+ |
| Console | CPU | 1+ cores |
| Console | Memory | 1GB+ |
| Database | CPU | 4+ cores |
| Database | Memory | 4GB+ |
| Redis | Memory | 1GB+ |
| MinIO | CPU | 2+ cores |
| MinIO | Memory | 4GB+ |

### Performance Optimization

1. **Caching:** Multi-level caching (LRU, Redis, browser)
2. **Connection Pooling:** Database and Redis connection pools
3. **Compression:** Automatic compression for text files
4. **Streaming:** Stream large files instead of loading into memory
5. **CDN:** Use CDN for static assets (future)
6. **Load Balancing:** Distribute traffic across multiple instances

## 📁 File Structure

See [Development Guide](development.md) for detailed file structure and conventions.

## 🔗 External Dependencies

### Core Dependencies

| Dependency | Purpose | Version |
|------------|---------|---------|
| Node.js | JavaScript runtime | 20.x |
| TypeScript | Type checking | 5.x |
| Express | Web framework | 4.x |
| Next.js | React framework | 16.x |
| PostgreSQL | Database | 16.x |
| Redis | Cache/Queue | 7.x |
| MinIO | Storage | Latest |
| Caddy | Web server | 2.x |
| Go | Programming language | 1.20+ |

### Libraries

| Library | Purpose | Service |
|---------|---------|---------|
| Drizzle ORM | Database ORM | API, Console |
| BullMQ | Job queue | API |
| ioredis | Redis client | API, Console |
| minio | S3 client | API |
| zod | Validation | API, Console |
| Better Auth | Authentication | Console |

## 📊 Monitoring

### Metrics

| Metric | Source | Purpose |
|--------|--------|---------|
| Request Count | Caddy | Traffic monitoring |
| Bandwidth | Caddy | Usage tracking |
| Response Time | Caddy | Performance monitoring |
| Cache Hit Rate | Caddy | Cache efficiency |
| Database Queries | PostgreSQL | Query performance |
| Job Queue | BullMQ | Background processing |

### Logging

| Level | Usage | Output |
|-------|-------|--------|
| Debug | Development | Console |
| Info | Normal operation | Console/File |
| Warn | Potential issues | Console/File |
| Error | Errors | Console/File/Alert |

### Alerting

| Condition | Severity | Action |
|-----------|----------|--------|
| High latency | Warning | Investigate |
| High error rate | Critical | Alert |
| Database down | Critical | Alert |
| Redis down | Critical | Alert |
| Storage down | Critical | Alert |

## 🎯 Future Architecture

### Microservices

- Split API service into smaller services
- Service mesh for inter-service communication
- API Gateway for request routing

### Kubernetes

- Container orchestration
- Auto-scaling
- Self-healing
- Service discovery

### CDN

- Global content distribution
- Edge caching
- DDoS protection

### Multi-Region

- Regional deployments
- Geo-routing
- Data replication

### Serverless

- Serverless functions for API
- Event-driven architecture
- Auto-scaling to zero

## 📚 References

- [Docker Documentation](https://docs.docker.com/)
- [Express Documentation](https://expressjs.com/)
- [Next.js Documentation](https://nextjs.org/docs)
- [PostgreSQL Documentation](https://www.postgresql.org/docs/)
- [Redis Documentation](https://redis.io/docs/)
- [MinIO Documentation](https://min.io/docs/)
- [Caddy Documentation](https://caddyserver.com/docs/)
