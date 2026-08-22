# PageX — TODO & Roadmap

> Source of truth for PageX implementation status and future roadmap.
>
> **Important:** Do not implement future roadmap items unless explicitly requested.
> Focus on making the current core deployment + blob-serving system correct, stable, and production-ready first.

---

# 1. Current Core Scope

PageX currently focuses on:

- Multi-tenant static hosting
- Immutable deployments
- Content-addressed blob storage
- Manifest-based file resolution
- Redis + L1 caching
- MinIO/S3-compatible blob storage
- Caddy/Go blob serving
- CLI-based deployment
- Deployment rollback
- Deployment garbage collection

Core serving path:

```text
Request
  ↓
Caddy / Blob Server
  ↓
site resolution
  ↓
active deployment
  ↓
manifest
  ↓
path → blob hash
  ↓
L1 → Redis → MinIO
  ↓
blob
```

`blob_tree_entries` must NOT be used as a request-time lookup table.

It is deployment/build-time metadata used to construct manifests.

---

# 2. ✅ Already Implemented

## Repository / Architecture

- [x] pnpm monorepo structure
- [x] TypeScript + ESM
- [x] API service
- [x] Console service
- [x] Go/Caddy blob-server
- [x] Shared packages
- [x] Docker Compose development infrastructure

## Storage

- [x] MinIO/S3-compatible storage
- [x] Content-addressed blobs
- [x] SHA-256 blob addressing
- [x] `blobs/{sha256}` object layout
- [x] Blob metadata in PostgreSQL
- [x] Shared blob storage
- [x] Legacy `tenant/{siteId}/` write path removed

## Deployments

- [x] Deployment records
- [x] Immutable deployment model
- [x] Active deployment pointer
- [x] Deployment version tracking
- [x] CLI deployment flow
- [x] Deployment commit flow
- [x] Deployment rollback
- [x] Deployment retention
- [x] Deployment garbage collection

## Manifest

- [x] `blob_tree_entries`
- [x] Manifest generation
- [x] Manifest validation before activation
- [x] Manifest persistence to MinIO
- [x] Manifest caching in Redis
- [x] Manifest-based serving
- [x] 24-hour Redis manifest TTL

## Request Serving

- [x] Subdomain → site resolution
- [x] Active deployment resolution
- [x] Manifest lookup
- [x] Path → blob hash resolution
- [x] L1 manifest cache
- [x] Redis manifest cache
- [x] MinIO manifest fallback
- [x] Direct blob lookup by hash
- [x] Brotli variants
- [x] Gzip variants
- [x] WebP variants

## Redis

- [x] Site cache
- [x] Active deployment cache
- [x] Site version
- [x] Manifest cache
- [x] Deployment token cache
- [x] Analytics counters

## Analytics

- [x] Request statistics
- [x] Bandwidth statistics
- [x] Status-class statistics
- [x] Human/bot statistics
- [x] Daily site statistics
- [x] Blob-server → Redis stats flow
- [x] Redis stats → PostgreSQL persistence

## Cleanup

- [x] Deployment retention
- [x] Expired deployment detection
- [x] Blob reference cross-check
- [x] MinIO-first deletion
- [x] Database cleanup after successful object deletion
- [x] GC failure isolation

---

# 3. 🟡 Current Core — Remaining Work

These are the important items to finish before calling the core production-ready.

## P0 — Deployment Safety

- [x] Add per-project/page deployment lock
- [x] Prevent concurrent deployments for the same page
- [x] Add deployment generation/version validation
- [x] Prevent stale builds from activating over newer deployments
- [x] Make deployment commit idempotent
- [x] Make retrying the same deploy safe

Expected behavior:

```text
Deploy A starts
Deploy B starts

Only one deployment may commit at a time.

If A becomes stale while B is newer:
A must NOT overwrite B.
```

---

## P0 — Database Invariants

- [x] Enforce only one active deployment per page at DB level
- [x] Add appropriate unique indexes
- [x] Review foreign-key consistency
- [x] Review cascading deletes
- [x] Review tenant-scoped constraints
- [x] Verify indexes for all hot queries

Important invariant:

```text
One page/project
    ↓
exactly zero or one active deployment
```

---

## P0 — Tenant Isolation

Every tenant-owned resource must be tenant-scoped.

Review:

- [x] pages
- [x] sites
- [x] builds
- [x] deployments
- [x] blob tree entries
- [x] domains
- [x] deployment tokens
- [x] rollback
- [x] deployment status
- [x] build status
- [x] analytics

Never trust only a resource ID.

Prefer:

```sql
WHERE id = $resourceId
AND tenant_id = $tenantId
```

---

## P1 — Manifest Integrity

Before activation verify:

- [x] Every path is valid
- [x] No duplicate paths
- [x] Every blob hash is valid SHA-256
- [x] Every referenced blob exists
- [x] Blob metadata is consistent
- [x] File count matches deployment metadata
- [x] Compression variants are valid
- [x] Manifest schema/version is valid
- [x] Manifest size has reasonable limits

A deployment must never become active with an invalid manifest.

---

## P1 — Crash / Recovery Safety

Review failure scenarios:

- [x] API crashes during deployment
- [x] MinIO unavailable
- [x] Redis unavailable
- [x] PostgreSQL unavailable
- [x] Process crashes after blob upload
- [x] Process crashes after manifest creation
- [x] Process crashes before activation
- [x] Process crashes after activation
- [x] GC crashes midway
- [x] Rollback crashes midway

Add reconciliation where necessary.

Desired model:

```text
PREPARING
   ↓
READY
   ↓
ACTIVATING
   ↓
ACTIVE
```

Failed/incomplete deployments must be recoverable.

---

## P1 — Blob Garbage Collection

Current GC is implemented.

Remaining hardening:

- [ ] Periodic orphan blob scanner
- [ ] Grace period for orphan blobs
- [ ] Detect blobs existing in MinIO but missing from DB
- [ ] Detect DB blob records missing from MinIO
- [ ] Add GC metrics
- [ ] Add dry-run GC mode
- [ ] Make GC resumable where practical

Never delete a blob unless it is proven unreferenced.

---

# 4. 🧪 Cloud Build — EXPERIMENTAL

> Cloud Build is currently **EXPERIMENTAL**.
>
> It is **not part of the core production-readiness milestone**.
> Do not block the core project on Cloud Build.

Current direction:

```text
Git repository
    ↓
BullMQ
    ↓
Experimental Build Worker
    ↓
Docker build environment
    ↓
Static output
    ↓
Existing blob deployment pipeline
```

Future Cloud Build work:

- [ ] Improve build isolation
- [ ] Improve timeout handling
- [ ] Improve build cancellation
- [ ] Improve build logs
- [ ] Improve resource limits
- [ ] Improve framework detection
- [ ] Improve output directory detection
- [ ] Add build cache
- [ ] Add build concurrency limits
- [ ] Add build quotas

Cloud Build should consume the existing deployment pipeline.

Do NOT redesign the core blob/manifest architecture specifically for Cloud Build.

---

# 5. 🟡 Documentation

Keep documentation synchronized with implementation.

- [x] Update `docs/architecture.md`
- [x] Ensure request flow describes manifest-first serving
- [x] Remove obsolete `blob_tree_entries` request-time references
- [x] Document current Redis cache hierarchy
- [x] Document deployment state transitions
- [x] Document GC behavior
- [x] Document rollback behavior
- [x] Document tenant isolation rules
- [x] Document deployment locking
- [x] Document failure/recovery behavior
- [x] Update `docs/SCHEMA.md`
- [x] Update `docs/WORKERS.md`

Documentation must reflect the actual code.

---

# 6. 🟡 Observability

Add production-grade metrics for:

## Request

- [ ] Total requests
- [ ] 2xx
- [ ] 3xx
- [ ] 4xx
- [ ] 5xx
- [ ] Request latency
- [ ] p50
- [ ] p95
- [ ] p99

## Cache

- [ ] L1 hit/miss
- [ ] Redis hit/miss
- [ ] MinIO manifest fallback
- [ ] Blob lookup latency

## Deployment

- [ ] Deployment duration
- [ ] Deployment failures
- [ ] Rollbacks
- [ ] Concurrent deployment conflicts
- [ ] Queue depth

## Storage

- [ ] Blob count
- [ ] Storage size
- [ ] Reused blobs
- [ ] Uploaded blobs
- [ ] GC deletions
- [ ] Orphan blobs

---

# 7. 🟢 Performance Improvements

Only after correctness is stable:

- [ ] Benchmark manifest lookup
- [ ] Benchmark L1 cache
- [ ] Benchmark Redis fallback
- [ ] Benchmark MinIO blob reads
- [ ] Benchmark concurrent requests
- [ ] Benchmark large manifests
- [ ] Benchmark large files
- [ ] Benchmark many small files
- [ ] Optimize memory usage
- [ ] Optimize manifest serialization/deserialization

Do not sacrifice correctness for micro-optimizations.

---

# 8. 🔵 Future — Custom Domains

Not required for the current core milestone.

Future:

- [ ] Domain table
- [ ] Custom hostname mapping
- [ ] Domain verification
- [ ] DNS verification
- [ ] SSL/TLS provisioning
- [ ] Certificate renewal
- [ ] Domain → project resolution

Target:

```text
example.com
www.example.com
app.example.com
      ↓
PageX Project
      ↓
Active Deployment
```

---

# 9. 🔵 Future — Preview Deployments

Not required for the current core milestone.

Future:

- [ ] Branch deployments
- [ ] PR deployments
- [ ] Preview URLs
- [ ] Deployment aliases
- [ ] Production alias
- [ ] Preview expiration
- [ ] Preview cleanup

Example:

```text
main
  ↓
production

feature/auth
  ↓
preview-auth.pagex.dev
```

---

# 10. 🔵 Future — CDN

> **CDN is intentionally postponed.**
>
> Do not implement CDN integration until the core PageX system works correctly and reliably.

Future architecture:

```text
Browser
   ↓
CDN
   ↓
Blob Server
   ↓
Manifest
   ↓
Blob Storage
```

Possible providers:

- Cloudflare
- CloudFront
- Other CDN providers

Future CDN work:

- [ ] CDN integration
- [ ] Cache headers
- [ ] Immutable asset caching
- [ ] HTML cache strategy
- [ ] Cache invalidation
- [ ] Compression/content negotiation
- [ ] Range requests
- [ ] CDN observability

Hashed assets should eventually use long-lived immutable caching.

Example:

```text
/app.abc123.js
Cache-Control: public, immutable
```

HTML should use a much shorter cache lifetime.

---

# 11. 🔵 Future — S3 / Cloud Storage

Current development uses MinIO/S3-compatible storage.

Future:

- [ ] AWS S3
- [ ] Cloudflare R2
- [ ] Other S3-compatible providers
- [ ] Storage abstraction testing
- [ ] Multipart uploads
- [ ] Lifecycle policies

The application should continue using the storage abstraction rather than provider-specific logic.

---

# 12. 🔵 Future — Multi-Region

Not required now.

Future:

```text
                 Global DNS/CDN
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
       Region A     Region B     Region C
          │            │            │
       Blob Server  Blob Server  Blob Server
          │            │            │
          └────────────┼────────────┘
                       │
                  Object Storage
```

Future work:

- [ ] Multi-region blob storage
- [ ] Regional blob servers
- [ ] Global routing
- [ ] Replication
- [ ] Failover
- [ ] Regional health checks

---

# 13. 🔵 Future — Runtime / Serverless

This is a separate future phase.

Do not mix runtime execution with the current static blob-serving milestone.

Potential future architecture:

```text
PageX
 ├── Static
 │    └── Blob Server
 │
 ├── Edge Worker
 │    └── Worker runtime
 │
 ├── Lambda
 │    └── Node.js runtime
 │
 └── Container
      └── isolated runtime
```

Possible future framework support:

- [ ] Next.js
- [ ] Nuxt
- [ ] SvelteKit
- [ ] Astro
- [ ] Python applications
- [ ] Node.js APIs
- [ ] Edge functions
- [ ] Serverless functions

---

# 14. 🚫 Explicitly Do NOT Do Yet

Until the current core is stable:

- [ ] Do NOT add CDN
- [ ] Do NOT add multi-region
- [ ] Do NOT add SSR runtime
- [ ] Do NOT add Lambda runtime
- [ ] Do NOT add Worker runtime
- [ ] Do NOT over-engineer Cloud Build
- [ ] Do NOT replace the manifest architecture
- [ ] Do NOT use `blob_tree_entries` for request-time serving
- [ ] Do NOT introduce unnecessary queues
- [ ] Do NOT introduce unnecessary databases
- [ ] Do NOT duplicate blobs per tenant/site

---

# 15. 🎯 Current Milestone — Core Static Hosting

The project is ready for the next phase when all of these are true:

- [x] Deployment locking works
- [x] Active deployment DB invariant is enforced
- [ ] Tenant isolation is verified
- [ ] Deployment commit is idempotent
- [ ] Manifest validation is robust
- [ ] Crash recovery is tested
- [ ] GC is reliable
- [ ] Blob serving is load tested
- [ ] Request path does not query `blob_tree_entries`
- [ ] Documentation matches implementation
- [ ] Metrics/observability are sufficient
- [ ] Security review completed
- [ ] End-to-end deployment tests pass

---

# 16. 🏁 Definition of Done

A feature is NOT considered complete merely because the happy path works.

For every core feature verify:

1. Happy path
2. Invalid input
3. Authentication failure
4. Tenant isolation
5. Concurrent requests
6. Concurrent deployments
7. Retry behavior
8. Process crash
9. Redis failure
10. PostgreSQL failure
11. MinIO failure
12. Rollback
13. Cleanup
14. Observability
15. Documentation

---

# 17. 🤖 Agent Instructions

When working on PageX:

1. Read this `TODO.md` first.
2. Read `docs/RULES.md`.
3. Read relevant architecture/schema documentation.
4. Inspect the current implementation before changing it.
5. Do not assume old documentation is correct.
6. Prefer current code + tests as implementation truth.
7. Do not implement future roadmap items unless explicitly requested.
8. Do not add CDN yet.
9. Treat Cloud Build as experimental.
10. Never use `blob_tree_entries` for normal request-time serving.
11. Preserve content-addressed blob storage.
12. Preserve immutable manifests.
13. Preserve rollback capability.
14. Never delete blobs without reference checking.
15. Always maintain tenant isolation.
16. Add tests for concurrency-sensitive changes.
17. Update documentation when behavior changes.
18. Run relevant tests/builds after changes.
19. Do not make unrelated architectural changes.
20. Keep the core system simple until it is proven stable.

---

# 18. 🚦 Current Priority

Work in this order:

```text
1. Deployment Lock
       ↓
2. Active Deployment DB Constraint
       ↓
3. Idempotent Deployment Commit
       ↓
4. Tenant Isolation Audit
       ↓
5. Manifest Integrity
       ↓
6. Crash/Recovery Handling
       ↓
7. GC Hardening
       ↓
8. Observability
       ↓
9. Load Testing
       ↓
10. Core Production Readiness
       ↓
────────────────────────────
          FUTURE
────────────────────────────
       ↓
Custom Domains
       ↓
Preview Deployments
       ↓
CDN
       ↓
Multi-region
       ↓
Runtime / Serverless
```
