# pagex-worker

Background cleanup consumer for PageX. A single long-lived Go process that
drains one Cloudflare Queue over the Queues **HTTP Pull** API.

It is **not** in the request path. Deployments are fully synchronous in the
console; this worker only performs cleanup that has already been committed to
PostgreSQL. If it is down, cleanup is delayed — deployments and project
deletions keep working.

Full design notes: [`services/console/docs/queue.md`](../console/docs/queue.md).

---

## Commands

```bash
go run ./cmd/worker provision   # idempotent: create queue, DLQ, and consumer
go run ./cmd/worker run         # long-lived HTTP pull consumer loop
go run ./cmd/worker version
```

From the repo root: `pnpm dev:worker`, `pnpm build:worker`, `pnpm test:worker`.

`provision` requires only `CF_ACCOUNT_ID` and `CF_QUEUE_API_TOKEN`; it does not
need the queue ID or any storage variable, so it works on a first run before the
worker has ever been started. Print the IDs it creates and set them in both the
console and the worker environment.

---

## Job types

```jsonc
{ "type": "deployment_gc", "page_id": "<uuid>", "site_id": "<uuid>", "deployment_id": "<uuid>" }
{ "type": "page_delete",  "page_id": "<uuid>", "site_id": "<uuid>" }
```

Contracts live in `services/console/src/server/api/queues/background-job.ts`;
the Go mirror is `internal/jobs/jobs.go`. Add a type to both.

Delivery is at-least-once, so every handler must be idempotent. A body that
fails to parse is ACKed and logged rather than retried — a malformed message
must not wedge the queue.

---

## Configuration

All configuration is environment variables. Nothing is read from a config file.

### Cloudflare Queues

| Variable | Required | Default | Notes |
|---|---|---|---|
| `CF_ACCOUNT_ID` | yes | — | |
| `CF_QUEUE_API_TOKEN` | yes | — | Queues Edit on the account |
| `CF_QUEUE_ID` | yes (runtime) | — | Not needed for `provision` |
| `CF_QUEUE_DLQ_ID` | no | — | Empty disables explicit DLQ pushes |
| `CF_QUEUE_NAME` | no | `pagex-background` | Used by `provision` |
| `CF_QUEUE_DLQ_NAME` | no | `pagex-background-dlq` | Used by `provision` |
| `CF_QUEUE_MAX_RETRIES` | no | `3` | Consumer retry limit, set by `provision` |
| `CF_QUEUE_RETENTION` | no | `96h` | Queue retention, set by `provision` |

### Storage

Deliberately the **same variable names the console uses**, so one `.env` drives
every service: `DATABASE_URL` (Neon), `MINIO_ENDPOINT_URL` or the
`MINIO_ENDPOINT`/`MINIO_PORT`/`MINIO_USE_SSL` trio, `MINIO_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_REGION`.

`MINIO_ENDPOINT_URL` is preferred because it is unambiguous; the host/port trio
is accepted for local MinIO.

### Redis (optional)

`UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN` + `REDIS_KEY_PREFIX`.
Cache invalidation is best-effort — when unset the worker skips it and the rows
are still deleted, relying on cache TTLs to expire stale entries.

### Tuning

| Variable | Default | Notes |
|---|---|---|
| `WORKER_CONCURRENCY` | `10` | In-flight jobs per container |
| `WORKER_BATCH_SIZE` | `10` | Messages requested per pull |
| `WORKER_VISIBILITY_TIMEOUT` | `30s` | Must exceed the slowest handler |
| `WORKER_POLL_INTERVAL` | `2s` | Delay after an empty pull |
| `WORKER_MAX_ATTEMPTS` | `3` | Retry budget before the DLQ |
| `WORKER_REQUEST_TIMEOUT` | `30s` | Per Cloudflare API call |
| `WORKER_DATABASE_MAX_CONNS` | `10` | **Per container** — see below |
| `WORKER_DELETE_BATCH_SIZE` | `100` | S3 multi-delete batch size |
| `WORKER_REDIS_CLEANUP` | `true` | |
| `CF_QUEUE_MAX_RETRIES` | `3` | Cloudflare-side retry limit, set on the consumer by `provision` |
| `CF_QUEUE_RETENTION` | `96h` | Message retention, set on the queue by `provision` |
| `DEPLOYMENT_RETENTION` | `10` | Deployments kept per page |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |

**Scaling:** raise `WORKER_CONCURRENCY` before adding replicas. Each container
opens its own pull loop *and* its own Postgres pool, so N replicas against Neon
means N × `WORKER_DATABASE_MAX_CONNS` connections.

---

## Package layout

| Path | Responsibility |
|---|---|
| `cmd/worker` | CLI entrypoint: `run`, `provision`, `version` |
| `internal/config` | Env loading and validation (`Load`, `LoadForProvision`) |
| `internal/cloudflare` | Queues HTTP client (pull/ack/retry/push) and provisioning |
| `internal/worker` | Pull loop, bounded concurrency, lease settlement |
| `internal/jobs` | Payload parsing and dispatch |
| `internal/cleanup` | The handlers: `deployment_gc`, `page_delete` |
| `internal/storage` | S3/MinIO deletion, Postgres access, Redis cache invalidation |

---

## Development

```bash
go build ./...
go vet ./...
go test ./...
gofmt -l .
```

Tests use `httptest` and `sqlmock`; nothing reaches the network or a real
database. `internal/cleanup` is the part to read first — it is the only code that
deletes rows and objects.

### Invariants worth preserving

- **Objects before rows.** A handler deletes S3 objects first and rows second. If
  an object delete fails, the rows stay so a retry can still find the object.
  Reversing the order orphans objects permanently.
- **Blob hashes are shared.** Only delete a hash no other project references.
- **The `sites` row is kept.** `page_delete` deactivates but never deletes the
  site, because `sites.subdomain` is unique and the row reserves the subdomain.
- **Do not make failures permanent.** A handler that returns an error is retried;
  one that panics or exits 0 on failure silently loses the cleanup job.

---

## Docker

```bash
docker build -f services/worker/Dockerfile -t pagex-worker services/worker
```

Or via Compose, which is how it is deployed:

```bash
docker compose up -d worker
docker compose run --rm worker provision   # first run only
```

The image is a two-stage build on `golang:1.26-alpine` → `alpine`, runs as
uid 10001, and `go vet` runs during the build so a broken image cannot ship.
