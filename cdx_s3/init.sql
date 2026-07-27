-- Create sites table
CREATE TABLE IF NOT EXISTS sites (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    subdomain   TEXT NOT NULL UNIQUE,
    active      BOOLEAN NOT NULL DEFAULT true,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sites_subdomain ON sites(subdomain);

-- Seed testing tenants
-- We hardcode the UUIDs so we know exactly what directories to create in MinIO
INSERT INTO sites (id, subdomain, active) VALUES
('550e8400-e29b-41d4-a716-446655440000', 'tenant-a', true),
('6ba7b810-9dad-11d1-80b4-00c04fd430c8', 'tenant-b', true)
ON CONFLICT (subdomain) DO NOTHING;

-- Create site daily statistics table
CREATE TABLE IF NOT EXISTS site_daily_stats (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id             UUID NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
    date                DATE NOT NULL,

    requests            BIGINT NOT NULL DEFAULT 0,
    bandwidth           BIGINT NOT NULL DEFAULT 0,

    requests_2xx        BIGINT NOT NULL DEFAULT 0,
    requests_3xx        BIGINT NOT NULL DEFAULT 0,
    requests_4xx        BIGINT NOT NULL DEFAULT 0,
    requests_5xx        BIGINT NOT NULL DEFAULT 0,

    humans              BIGINT NOT NULL DEFAULT 0,
    bots                BIGINT NOT NULL DEFAULT 0,
    unique_ips          BIGINT NOT NULL DEFAULT 0,

    peak_hour           TEXT,
    peak_hour_requests  BIGINT NOT NULL DEFAULT 0,

    updated_at          TIMESTAMPTZ DEFAULT NOW(),

    UNIQUE (site_id, date)
);

CREATE INDEX IF NOT EXISTS idx_site_daily_stats_site_date ON site_daily_stats(site_id, date);
