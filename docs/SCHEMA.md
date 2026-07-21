# Cloudisy — Database Schema & Redis Keys

---

## PostgreSQL Tables

### `sites`
One row per project. The Caddy `static_s3` plugin reads this table to resolve subdomain → site UUID.

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
Tenant project metadata. `site_id` is the MinIO key prefix.

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

requests            BIGINT  DEFAULT 0
bandwidth           BIGINT  DEFAULT 0

requests_2xx        BIGINT  DEFAULT 0
requests_3xx        BIGINT  DEFAULT 0
requests_4xx        BIGINT  DEFAULT 0
requests_5xx        BIGINT  DEFAULT 0

humans              BIGINT  DEFAULT 0
bots                BIGINT  DEFAULT 0
unique_ips          BIGINT  DEFAULT 0

peak_hour           TEXT    -- "YYYY-MM-DD:HH"
peak_hour_requests  BIGINT  DEFAULT 0

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
job_id        TEXT      -- BullMQ job ID (set after enqueue)
status        TEXT      NOT NULL DEFAULT 'queued'
              -- values: queued | active | completed | failed

repo_url      TEXT      NOT NULL
git_provider  TEXT      NOT NULL  -- github | gitlab
framework     TEXT      NOT NULL
build_command TEXT      NOT NULL DEFAULT 'pnpm build'
output_dir    TEXT      -- nullable; auto-detected if null
error         TEXT      -- populated on failure
triggered_by  TEXT      NOT NULL DEFAULT 'cli'

created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
completed_at  TIMESTAMPTZ -- set by worker on finish

INDEX: idx_builds_page_tenant_status ON (page_id, tenant_id, status)
```

---

### `deployments`
Snapshot and deployment history. One row per deploy event. Only one per page has `is_active = true` at any time.

```sql
id               UUID     PRIMARY KEY
page_id          UUID     FK → pages(id) ON DELETE CASCADE
site_id          UUID     FK → sites(id)
tenant_id        TEXT     NOT NULL
build_id         UUID     FK → builds(id)  -- NULL for ZIP uploads
version          INTEGER  NOT NULL          -- auto-incremented per page
snapshot_prefix  TEXT     NOT NULL          -- MinIO prefix of this version's snapshot
                          -- format: "snapshots/{site_id}/v{version}/"
is_active        BOOLEAN  NOT NULL DEFAULT false
source           TEXT     NOT NULL  -- 'build' | 'upload'
file_count       INTEGER  NOT NULL
created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
```

**Retention policy:** After each deploy, versions beyond the last 5 are deleted from both MinIO and this table.

---

## Drizzle Migration Files

| File | Contents |
|------|----------|
| `drizzle/0000_powerful_switch.sql` | Initial schema (sites, pages, site_daily_stats) |
| `drizzle/0001_same_valeria_richards.sql` | Added builds table |
| `drizzle/0002_tough_madame_hydra.sql` | Added deployments table |

**Generate new migration:**
```bash
npm run gen   # runs: drizzle-kit generate
```

**Apply migrations:**
```bash
npm run migrate  # runs: drizzle-kit migrate
```

---

## Redis Key Reference

| Key pattern | Type | TTL | Written by | Read by |
|------------|------|-----|-----------|---------|
| `site:{subdomain}` | String (UUID) | 5 min | Caddy plugin | Caddy plugin |
| `requests:{domain}` | String (int counter) | — | Caddy plugin | sync.worker, page.service |
| `bandwidth:{domain}` | String (int counter) | — | Caddy plugin | sync.worker, page.service |
| `db_cache:{domain}` | JSON `{request, bandwidth_usage}` | 15 min | page.service | page.service |

**BullMQ internal keys** (managed automatically by BullMQ):
- Queue names: `UPLOAD_QUEUE`, `CLOUDISY_CLOUD_BUILDS_QUEUE`, `SYNC_QUEUE`
- Job logs stored per job ID; accessed via `buildQueue.getJobLogs(jobId, start)`

---

## ORM Import Pattern

```typescript
// Always import table objects from schema
import { pages, sites, builds, deployments } from '../infrastructure/db/schema.js'
import { db } from '../infrastructure/db/db.js'
import { eq, and, desc, ne } from 'drizzle-orm'

// Example select
const [record] = await db
    .select()
    .from(pages)
    .where(and(eq(pages.id, pageId), eq(pages.tenant_id, tenantId)))
    .limit(1)

// Example update
await db
    .update(builds)
    .set({ status: 'completed', completed_at: new Date() })
    .where(eq(builds.id, buildId))
```
