# Cloudisy — Database Schema & Redis Keys

---

## PostgreSQL Tables

### `sites`
One row per project. Caddy resolves subdomain → site UUID.

```sql
id          UUID        PRIMARY KEY DEFAULT gen_random_uuid()
subdomain   TEXT        UNIQUE NOT NULL
active      BOOLEAN     NOT NULL DEFAULT true
created_at  TIMESTAMP   NOT NULL DEFAULT now()

INDEX: idx_sites_subdomain ON (subdomain)
```

**Caddy query:** `SELECT id FROM sites WHERE subdomain = $1 AND active = true`

---

### `pages`
Tenant project metadata. `site_id` keys the Redis `active_deployment:{site_id}` / `site_version:{site_id}` values.

```sql
id               UUID     PRIMARY KEY
site_id          UUID     FK → sites(id) ON DELETE CASCADE
tenant_id        TEXT     NOT NULL
tenant_name      TEXT     NOT NULL
plan             TEXT     NOT NULL DEFAULT 'free'
domain           TEXT     NOT NULL  -- e.g. mysite.localhost
project_name     TEXT     NOT NULL

request          BIGINT   NOT NULL DEFAULT 0
request_limit    BIGINT   NOT NULL DEFAULT 100000

bandwidth_usage  BIGINT   NOT NULL DEFAULT 0
bandwidth_limit  BIGINT   NOT NULL DEFAULT 2147483648  -- 2 GB

createdAt        TIMESTAMP NOT NULL DEFAULT now()
```

---

### `site_daily_stats`
Per-site daily analytics written by the Caddy plugin.

```sql
id                  UUID    PRIMARY KEY
site_id             UUID    FK → sites(id) ON DELETE CASCADE
date                DATE    NOT NULL
requests / bandwidth / status-class / humans / bots / unique_ips / peak_* …
updated_at          TIMESTAMP DEFAULT now()

INDEX: idx_site_daily_stats_site_date ON (site_id, date)
```

---

### `builds`
Build job records. One row per triggered build.

```sql
id            UUID      PRIMARY KEY
page_id       UUID      FK → pages(id) ON DELETE CASCADE
tenant_id     TEXT      NOT NULL
job_id        TEXT      -- BullMQ job ID
status        TEXT      NOT NULL DEFAULT 'queued'
              -- queued | running | completed | failed | cancelled
repo_url / git_provider / framework / build_command / output_dir / error / triggered_by
created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
completed_at  TIMESTAMPTZ

INDEX: idx_builds_page_tenant_status ON (page_id, tenant_id, status)
CHECK: builds_status_check (status IN ('queued','running','completed','failed','cancelled'))
```

---

### `blobs`
Content-addressed blob store (SHA256 → MinIO object `blobs/{hash}`).

```sql
hash         TEXT     PRIMARY KEY   -- SHA256 hex
size         INTEGER  NOT NULL
created_at   TIMESTAMP DEFAULT now()
```

---

### `deployments`
Deployment history. Exactly one row per page has `is_active = true`.

```sql
id               UUID     PRIMARY KEY
page_id          UUID     FK → pages(id) ON DELETE CASCADE
site_id          UUID     FK → sites(id)
tenant_id        TEXT     NOT NULL
build_id         UUID     FK → builds(id) ON DELETE SET NULL  -- NULL for CLI uploads
version          INTEGER  NOT NULL
is_active        BOOLEAN  NOT NULL DEFAULT false
status           TEXT     NOT NULL DEFAULT 'pending'
                 -- pending | active | failed | superseded
source           TEXT     NOT NULL  -- 'build' | 'upload'
file_count       INTEGER  NOT NULL
files_deployed   INTEGER
files_reused     INTEGER
manifest_key     TEXT     -- MinIO object key (immutable manifest)
manifest_version INTEGER
manifest_size    INTEGER
manifest_hash    TEXT     -- SHA256 of serialized manifest
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()

UNIQUE (page_id, version)
UNIQUE (page_id) WHERE (is_active = true)  -- partial index: one active per page
CHECK: deployments_status_check (status IN ('pending','active','failed','superseded'))
CHECK: deployments_source_check (source IN ('build','upload'))
CHECK: deployments_active_requires_manifest (is_active → manifest fields NOT NULL)
INDEX: idx_deployments_page_active ON (page_id, is_active)
INDEX: idx_deployments_page_tenant_version ON (page_id, tenant_id, version)
INDEX: idx_deployments_page_tenant ON (page_id, tenant_id)
INDEX: idx_deployments_build_id ON (build_id)
INDEX: idx_deployments_status ON (status)
```

**Retention / GC** (`DEPLOYMENT_RETENTION = 10`):
- Keep the active deployment + up to **10** most recent inactive deployments
- Steady state ≤ **11** rows per page
- Background `runDeploymentGC` (after commit/rollback) deletes older inactive rows, their `blob_tree_entries`, and orphaned `blobs` rows **after** successful MinIO deletes
- Active deployment is never a GC target (`is_active = false` filter)

---

### `blob_tree_entries`
File tree per deployment (path → blob hash), including compressed/WebP variants.

```sql
id              UUID  PRIMARY KEY
deployment_id   UUID  FK → deployments(id) ON DELETE CASCADE
path            TEXT  NOT NULL   -- e.g. index.html, index.html.br, photo.png.webp
blob_hash       TEXT  FK → blobs(hash)

UNIQUE (deployment_id, path)
INDEX idx_blob_tree_entries_deployment ON (deployment_id)
```

---

### `idempotency_keys`
Ensures deployment/build requests are idempotent. Scoped by `(tenant_id, page_id, idempotency_key)`.

```sql
id              UUID    PRIMARY KEY
tenant_id       TEXT    NOT NULL
page_id         UUID    FK → pages(id) ON DELETE CASCADE
idempotency_key TEXT    NOT NULL
resource_type   TEXT    NOT NULL  -- 'deployment' | 'build'
resource_id     UUID    NOT NULL  -- created deployment/build UUID
request_hash    TEXT    -- SHA256 of request body (for additional safety)
created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
expires_at      TIMESTAMPTZ NOT NULL

UNIQUE (tenant_id, page_id, idempotency_key)
CHECK: idempotency_keys_resource_type_check (resource_type IN ('deployment','build'))
INDEX: idx_idempotency_keys_expires ON (expires_at)
INDEX: idx_idempotency_keys_tenant_page ON (tenant_id, page_id)
INDEX: idx_idempotency_keys_resource ON (resource_type, resource_id)
```

---

## Drizzle Migration Files

| File | Contents |
|------|----------|
| `drizzle/0000_*.sql` | Initial schema (sites, pages, site_daily_stats) |
| `drizzle/0001_*.sql` | builds table |
| `drizzle/0002_*.sql` | deployments table |
| `drizzle/0003_*.sql` | blobs / blob_tree_entries |
| `drizzle/0004_*.sql` | deployments: drop snapshot_prefix |
| `drizzle/0005_*.sql` | deployments: manifest columns + site_daily_stats unique |
| `drizzle/0006_*.sql` | DB invariants indexes (partial unique active per page) |
| `drizzle/0007_curly_pride.sql` | Idempotency keys table, FK build_id SET NULL, CHECK constraints |
| `drizzle/0008_nervous_shadowcat.sql` | deployments: status column + index |

```bash
npm run gen       # drizzle-kit generate
npm run migrate   # drizzle-kit migrate (also on compose up)
```

---

## Redis Key Reference

| Key pattern | DB | Type | TTL | Written by | Read by |
|------------|----|------|-----|-----------|---------|
| `site:{subdomain}` | 0 | String (UUID) | 5 m | Caddy / API invalidation | Caddy |
| `active_deployment:{site_id}` | 0 | String (deployment UUID) | — | deploy / rollback | Caddy |
| `site_version:{site_id}` | 0 | Integer | — | deploy / rollback (`INCR`) | Caddy |
| `manifest:{deployment_id}` | 0 | JSON manifest | 24 h | deploy / rollback | Caddy (L1 → Redis → MinIO) |
| `deploy:token:{token}` | 3 | JSON | 10 min | prepareDeploy | presign / commit |
| `deploy:lock:{pageId}` | 3 | String (holder id) | 10 min prepare / ~6 min commit | prepare / commit / rollback | prepare / commit / rollback |
| `stats:*` | 3 | counters | — | blob-server analytics | blob-server flush → `site_daily_stats` |
| `db_cache:{domain}` | 3 | JSON | 15 min | page.service | page.service |

**BullMQ (DB2):** queues `cloudisy-cloud-builds` (main), `cloudisy-cloud-builds-dlq` (dead letter).

---

## ORM Import Pattern

```typescript
import { pages, sites, builds, deployments, blobs, blobTreeEntries, idempotencyKeys } from '../infrastructure/db/schema.js'
import { db } from '../infrastructure/db/db.js'
import { eq, and, desc, ne, inArray, notInArray } from 'drizzle-orm'

const [record] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)))
    .limit(1)
```