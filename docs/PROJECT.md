# PageX — Documentation & Overview

> **Purpose of this file:** Snapshot of the PageX monorepo architecture and components.

---

## What This Is

**PageX** is a multi-tenant static-site hosting platform. Each user project ("page") is served as a subdomain from content-addressed MinIO blobs via Caddy and deployment manifests.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js (ESM, TypeScript compiled to `dist/`) |
| HTTP Framework | Express 5 |
| Database | PostgreSQL via Drizzle ORM |
| Cache & Locks | Redis (ioredis) — DB0 site/active_deployment/manifest, DB3 tokens/deploy locks |
| Object Storage | MinIO (S3-compatible) |
| Auth | JOSE — JWKS from console (`AUTH_JWKS_URL`) |
| Image / compress | `sharp` (WebP), Node `zlib` (Brotli/Gzip) |
| Validation | Zod + `file-type` magic bytes |
| Rate limiting | express-rate-limit + rate-limit-redis |
| Concurrency | `p-limit` (blob I/O + GC deletes) |

---

## Service Layout

```
services/
├── api/                      # Express 5 REST API
│   ├── routes/               # page, deploy, deployment routes
│   ├── controllers/          # thin HTTP controller handlers
│   ├── services/             # deploy, deployment, lock, page, gc, idempotency
│   └── infrastructure/       # db (drizzle), cache (redis), storage (minio)
├── blob-server/              # Caddy + static_s3 Go plugin
└── console/                  # Next.js App Router UI
```

---

## Deploy Architecture

All deploys are handled via the CLI deploy API:
- `POST /api/deploy/prepare`
- `POST /api/deploy/presign`
- `POST /api/deploy/commit`

Cloud builds and BullMQ background workers have been removed.

---

## MinIO Storage Layout

```
{MINIO_BUCKET}/
  blobs/{sha256}          ← live serving path (immutable content-addressed objects)
  manifests/{deployment}  ← deployment manifest JSON
```

Caddy resolves path → hash via the active deployment manifest → `blobs/{hash}`.
