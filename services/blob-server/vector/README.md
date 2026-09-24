# Vector metrics / usage pipeline

Asynchronous usage and metrics for the PageX blob-server.

```
Caddy + cdx_s3 + LRU
        │
        ▼
   JSON access logs   (/var/log/caddy/access.log)
        │
        ▼
      Vector          (this directory)
        │  reduce per site+hour
        ▼
  POST /internal/usage/ingest   (HTTP, bearer-token auth)
        │
        ▼
      API service               (transactional + idempotent)
        │
        ▼
     PostgreSQL
```

## What is tracked

| Stream | Destination | Purpose |
|--------|-------------|---------|
| Bandwidth bytes | `bandwidth_usage_hourly` | **Billable usage** |
| Requests, status, latency, cache | `service_metrics_hourly` | Operational only — never billed |
| Daily rollup | `site_daily_stats` | Console usage endpoint compatibility |

Storage quota continues to come from deployment blob trees (not access logs).

Requests are unlimited and are **not** used for billing. Only `bandwidth_bytes`
(and `storage_bytes`) are billable.

## Requirements

1. Apply API migration `0012_normal_vulcan.sql` (`usage_ingest_dedup`).
2. Caddy writes JSON access logs with `site_id` / `deployment_id` / `cache_hit`
   (plugin `ExtraLogFields`).
3. Share `/var/log/caddy` between `blob-server` and `vector`.
4. Set `USAGE_INGEST_TOKEN` (shared secret) and `USAGE_API_URL`
   (e.g. `http://api:3000/internal/usage/ingest`).

Do **not** enable Caddy `analytics on` / Redis buffering at the same time — that
would double-count. The blob-server no longer talks to Redis.

## Local / Compose

```bash
# from repo root
docker compose up -d vector
```

Vector image: `timberio/vector:0.46.1-alpine` (the official image; the pipeline
uses only the built-in `file` source, `remap`/`reduce` transforms, and `http`
sink — no beta `postgres` sink, no DB credentials).

## Idempotency & reliability

- File source checkpoints under `/var/lib/vector` (`read_from: end`).
- End-to-end acknowledgements: log offsets advance only after the API accepts
  the batch.
- Each record carries a deterministic `ingest_id`; the API's `usage_ingest_dedup`
  table skips already-applied records, so retries/replays never double-count.
- The HTTP sink uses a **disk** buffer to survive API outages.
- Caddy log rotation (`roll_size` / `roll_keep`) is followed via the file source
  include globs.

## Memory

Target footprint is small relative to a ~1 GiB / 0.5 vCPU blob host:

- Short `reduce` windows (30s flush)
- One 256 MiB disk buffer
- No Redis, no in-memory event store for usage
