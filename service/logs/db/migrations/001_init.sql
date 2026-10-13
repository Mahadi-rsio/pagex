-- PageX logs service schema.
-- Idempotent: safe to re-run. Apply with the *direct* (non-pooled) Neon
-- connection string via psql:
--
--   psql "$LOGS_DATABASE_URL_DIRECT" -f db/migrations/001_init.sql
--
-- The worker itself uses the *pooled* connection string at runtime.

-- Files whose raw R2 object has already been folded into usage_hourly.
-- `key` is the R2 object key (e.g. raw/20261013/...); RayIDs are never stored.
CREATE TABLE IF NOT EXISTS processed_files (
    key          text PRIMARY KEY,
    processed_at timestamptz NOT NULL DEFAULT now()
);

-- Files discovered in R2 but not yet processed. Written by the drain step,
-- consumed by the process step.
CREATE TABLE IF NOT EXISTS pending_files (
    key        text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);

-- Per-host, per-hour aggregates. `hour` is the UTC hour bucket derived from
-- the log record's EdgeStartTimestamp.
CREATE TABLE IF NOT EXISTS usage_hourly (
    host       text        NOT NULL,
    hour       timestamptz NOT NULL,
    requests   bigint      NOT NULL DEFAULT 0,
    bytes      bigint      NOT NULL DEFAULT 0,
    s2xx       bigint      NOT NULL DEFAULT 0,
    s3xx       bigint      NOT NULL DEFAULT 0,
    s4xx       bigint      NOT NULL DEFAULT 0,
    s5xx       bigint      NOT NULL DEFAULT 0,
    cache_hits bigint      NOT NULL DEFAULT 0,
    PRIMARY KEY (host, hour)
);

-- Per-host, per-hour, per-country request counts.
CREATE TABLE IF NOT EXISTS country_hourly (
    host     text        NOT NULL,
    hour     timestamptz NOT NULL,
    country  text        NOT NULL,
    requests bigint      NOT NULL DEFAULT 0,
    PRIMARY KEY (host, hour, country)
);

CREATE INDEX IF NOT EXISTS usage_hourly_hour_idx ON usage_hourly (hour);
CREATE INDEX IF NOT EXISTS country_hourly_hour_idx ON country_hourly (hour);
