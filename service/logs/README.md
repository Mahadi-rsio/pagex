# PageX logs service

Counts HTTP requests, bytes, status classes, and cache hits per tenant host
(`*.cloudisy.top`), bucketed by UTC hour, from Cloudflare Logpush data. Raw log
files stay in R2; only aggregates land in Neon Postgres.

This replaces the blob-server's former in-process usage tracker.

## Architecture

```
Cloudflare Logpush (http_requests, zone-scoped)
        │  ndjson, rfc3339
        ▼
R2 bucket  logs-raw/raw/{YYYYMMDD}/...
        │  event notification: PutObject, prefix raw/  →  Queue
        ▼
Cloudflare Queue  (HTTP pull consumer)
        │  Go worker pulls leases, records keys, acks
        ▼
Fly.io machine  pagex-logs  (one-shot, started by cron)
        │  drain → pending_files → aggregate → Neon
        ▼
Neon Postgres  usage_hourly, country_hourly
```

- **Cloudflare Cron Worker** (`cron/`) POSTs the Fly Machines API every 25
  minutes to start the worker machine; the machine has no HTTP service, runs
  once, and exits.
- **Go worker** (`worker/`) pulls queue messages, writes each object key to
  `pending_files`, acks, then folds every pending R2 object into Neon and marks
  it in `processed_files`. R2 is never listed.
- R2 objects are only read by key. RayIDs are never persisted (dedupe is by
  object key).

## Layout

```
service/logs/
├── README.md
├── .env.example
├── fly.toml                 # Fly app config (one-shot task machine)
├── db/migrations/
│   └── 001_init.sql         # idempotent schema
├── infra/
│   ├── setup.sh             # one-time infra provisioning
│   ├── fly.toml             # copy of ../fly.toml (reference)
│   └── logpush.json.tmpl    # Logpush job body template
├── worker/                  # Go: queue pull + R2 read + aggregate + Neon write
│   ├── main.go cfqueue.go keys.go process.go process_test.go
│   ├── testdata/sample.ndjson
│   ├── go.mod go.sum Dockerfile
└── cron/                    # Cloudflare Cron Worker (starts the Fly machine)
    ├── src/index.ts wrangler.toml package.json tsconfig.json biome.json
```

## Data model

| table | key | columns |
|-------|-----|---------|
| `usage_hourly` | `(host, hour)` | `requests, bytes, s2xx, s3xx, s4xx, s5xx, cache_hits` |
| `country_hourly` | `(host, hour, country)` | `requests` |
| `pending_files` | `key` | `created_at` |
| `processed_files` | `key` | `processed_at` |

`hour` is the `EdgeStartTimestamp` truncated to the UTC hour.

`cache_hits` counts `CacheCacheStatus` values `hit` and `stream_hit`. (The
original design named `CacheResponseStatus`, but that field is deprecated in
the `http_requests` dataset; the worker selects `CacheCacheStatus`.)

## Setup

```sh
cp .env.example .env          # fill in values
bash infra/setup.sh
```

`setup.sh` creates the R2 bucket, queue, event notification, and HTTP pull
consumer; applies the migration; registers the Logpush job (including the
ownership challenge); deploys the Fly worker and cron worker. It is idempotent.

Then finish the two manual steps it prints (Wrangler `FLY_API_TOKEN` secret and
the `FLY_MACHINE_ID` var in `cron/wrangler.toml`).

## Operations

Local aggregate check against sample data:

```sh
cd worker
go run . -file testdata/sample.ndjson
go test ./...
```

Run the worker by hand:

```sh
flyctl machine start "$(flyctl machine list -a pagex-logs --json | jq -r '.[0].id')"
flyctl logs --app pagex-logs
```

Verify in Neon:

```sql
SELECT host, hour, requests, bytes, s2xx, s3xx, s4xx, s5xx, cache_hits
FROM usage_hourly
ORDER BY hour DESC
LIMIT 20;
```

## Schema changes

`db/migrations/*.sql` is the source of truth. `worker/main.go` embeds an
equivalent `schemaDDL` so the worker is self-sufficient on first run — keep the
two in sync when the schema changes.

## Unverified / operational caveats

- **Logpush job.** Created manually in the dashboard (destination `r2://logs-raw/raw/{DATE}`; the API token does not have `Logs Write`). The exact field set and destination must be confirmed from the first real file.
- **Cron Triggers require the Workers Paid plan.** The cron worker also exposes
  `POST /start`, so a free-plan deployment can be driven by an external
  scheduler instead.
- **Implementation verified live on Fly/Cloudflare** (2026-10-13): queue
  pull+ack, `pending_files` insert, R2 get, Neon writes, exit 0, and the
  `restart = no` one-shot behaviour — driven through the cron worker's
  `POST /start`. `CREATE TABLE` migrations run on the pooled Neon URL work, but
  a direct URL is preferred for DDL.
- **`.env` values must not be `source`d** — a URL containing `&` (e.g.
  `?sslmode=require&channel_binding=require`) truncates the variable when
  shell-sourced. `infra/setup.sh` parses `.env` line-by-line instead.
- **R2 destination `destination_conf`.** The S3 secret is embedded verbatim;
  if it contains URL-reserved characters the value may need percent-encoding.
- **Queues pull/ack API** follows the HTTP pull-consumer contract; messages
  published as `json` arrive base64-encoded and are decoded by the worker.
- `processed_files` grows unbounded; add retention if needed.
