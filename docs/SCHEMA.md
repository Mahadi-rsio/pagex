# PageX — Database Schema

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
Per-site daily analytics written by the API usage-ingest service (fed by Vector).

```sql
id                  UUID    PRIMARY KEY
site_id             UUID    FK → sites(id) ON DELETE CASCADE
date                DATE    NOT NULL
requests / bandwidth / status-class / humans / bots / unique_ips / peak_* …
updated_at          TIMESTAMP DEFAULT now()

INDEX: idx_site_daily_stats_site_date ON (site_id, date)
```

---

### `bandwidth_usage_hourly`
Billing **usage** aggregate (bandwidth only), written by the API usage-ingest service (fed by Vector).
Hourly buckets are additive (`ON CONFLICT ... DO UPDATE SET bytes = bytes + EXCLUDED.bytes`).

```sql
tenant_id   TEXT      NOT NULL
site_id     UUID      FK → sites(id) ON DELETE CASCADE
bucket      TIMESTAMPTZ NOT NULL   -- truncated to the hour (UTC)
bytes       BIGINT    NOT NULL DEFAULT 0
updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()

PRIMARY KEY: bandwidth_usage_hourly_pk (tenant_id, site_id, bucket)
INDEX: idx_bandwidth_usage_tenant_bucket ON (tenant_id, bucket)
INDEX: idx_bandwidth_usage_site_bucket   ON (site_id, bucket)
```

Tenant id is resolved at ingest time via `INSERT ... SELECT p.tenant_id FROM pages p WHERE p.site_id = $1`
(no per-request DB lookup). **Requests are not metered here** — bandwidth only.

---

### `service_metrics_hourly`
Operational **metrics** (separate from billing usage), written by the API usage-ingest service (fed by Vector).

```sql
site_id         UUID      FK → sites(id) ON DELETE CASCADE
bucket          TIMESTAMPTZ NOT NULL   -- truncated to the hour (UTC)
requests        BIGINT    NOT NULL DEFAULT 0
status_2xx / status_3xx / status_4xx / status_5xx   BIGINT NOT NULL DEFAULT 0
bytes           BIGINT    NOT NULL DEFAULT 0
cache_hits / cache_misses                            BIGINT NOT NULL DEFAULT 0
latency_sum_ms  BIGINT    NOT NULL DEFAULT 0
latency_le_50 / _100 / _250 / _500 / _1000 / _2500   BIGINT NOT NULL DEFAULT 0  -- cumulative
updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()

PRIMARY KEY: service_metrics_hourly_pk (site_id, bucket)
INDEX: idx_service_metrics_site_bucket ON (site_id, bucket)
INDEX: idx_service_metrics_bucket      ON (bucket)
```

`latency_le_*` are cumulative counts (a request increments every bound ≥ its duration);
percentiles are estimated from these buckets, not stored raw.

---

### `builds` (legacy, unused)
Cloud-build job records from the removed BullMQ/cloud-build stack. Retained so no migration is needed; no writer remains.

```sql
id            UUID      PRIMARY KEY
page_id       UUID      FK → pages(id) ON DELETE CASCADE
tenant_id     TEXT      NOT NULL
job_id        TEXT      -- legacy BullMQ job ID (unused)
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

### `usage_ingest_dedup`
Idempotency ledger for the usage-ingest pipeline. The API's ingest service applies pre-aggregated records
transactionally and uses this table to deduplicate records from Vector's repeated POSTs.

```sql
ingest_id   TEXT        PRIMARY KEY
applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
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
| `drizzle/0009_db_invariants.sql` | DB invariants indexes (hand-written) |
| `drizzle/0010_idempotency_status.sql` | idempotency_keys: status column + index (hand-written, no snapshot) |
| `drizzle/0011_red_true_believers.sql` | `bandwidth_usage_hourly` + `service_metrics_hourly` tables |
| `drizzle/0012_normal_vulcan.sql` | `usage_ingest_dedup` idempotency ledger table |

```bash
pnpm db:generate   # drizzle-kit generate (auth + API configs)
pnpm db:migrate    # apply both migration histories
```

---

## Redis Key Reference

| Key pattern | Type | TTL | Written by | Read by |
|------------|------|-----|-----------|---------|
| `site:{subdomain}` | String (UUID) | 5 m | Caddy / API invalidation | Caddy |
| `active_deployment:{site_id}` | String (deployment UUID) | — | deploy / rollback | Caddy |
| `site_version:{site_id}` | Integer | — | deploy / rollback (`INCR`) | Caddy |
| `manifest:{deployment_id}` | JSON manifest | 24 h | deploy / rollback | Caddy (L1 → Redis → MinIO) |
| `deploy:token:{token}` | JSON | 10 min | prepareDeploy | presign / commit |
| `deploy:lock:{pageId}` | String (holder id) | 10 min prepare / ~6 min commit | prepare / commit / rollback | prepare / commit / rollback |
| `db_cache:{domain}` | JSON | 15 min | page.service | page.service |

All keys are namespaced with a `px:` prefix (override with `REDIS_KEY_PREFIX`). Upstash exposes a
single logical database, so the former `db0`/`db3` split is expressed purely by key prefix.

**Billing unit is decimal GB (1 GB = 1,000,000,000 bytes).** Only bandwidth is metered;
request counts are unlimited and never quota-checked.

**BullMQ was removed** — there are no queue keys. `deploy:lock:{pageId}` is the only lock mechanism.

---

## ORM Import Pattern

```typescript
import { pages, sites, builds, deployments, blobs, blobTreeEntries, idempotencyKeys, usageIngestDedup } from '../infrastructure/db/schema.js'
import { db } from '../infrastructure/db/db.js'
import { eq, and, desc, ne, inArray, notInArray } from 'drizzle-orm'

const [record] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)))
    .limit(1)
```