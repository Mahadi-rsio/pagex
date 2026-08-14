package cdx_s3

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/tursodatabase/libsql-client-go/libsql"
)

// tursoEnvURL is the environment variable that enables the Turso read replica.
const tursoEnvURL = "TURSO_DATABASE_URL"

// DefaultTursoTimeout bounds every Turso read-replica round trip so a slow or
// unreachable Turso never turns a static request into a long-running one.
const DefaultTursoTimeout = 2 * time.Second

// TursoConfig holds connection settings for the libSQL/Turso read replica.
// Credentials come only from environment variables — never hardcoded.
type TursoConfig struct {
	DatabaseURL string
	AuthToken   string
	Timeout     time.Duration
}

// TursoConfigured reports whether a Turso database URL has been configured.
// When false the entire Turso read path is disabled and PageX uses the
// existing Redis/PostgreSQL architecture unchanged.
func TursoConfigured() bool {
	return os.Getenv(tursoEnvURL) != ""
}

// LoadTursoConfig reads the Turso read-replica configuration from the
// environment. TURSO_AUTH_TOKEN is optional (self-hosted libSQL endpoints may
// not require authentication); the token is never logged or committed.
func LoadTursoConfig() TursoConfig {
	timeout := DefaultTursoTimeout
	if raw := os.Getenv("TURSO_TIMEOUT"); raw != "" {
		if d, err := time.ParseDuration(raw); err == nil && d > 0 {
			timeout = d
		}
	}
	return TursoConfig{
		DatabaseURL: os.Getenv(tursoEnvURL),
		AuthToken:   os.Getenv("TURSO_AUTH_TOKEN"),
		Timeout:     timeout,
	}
}

// OpenTurso opens a database/sql handle to a Turso/libSQL database using the
// official libSQL HTTP driver. The driver is pure Go (no CGO), so it builds
// with CGO_ENABLED=0. The returned handle is lazy: no network I/O happens
// until the first query, and every query honors its context timeout.
func OpenTurso(cfg TursoConfig) (*sql.DB, error) {
	if cfg.DatabaseURL == "" {
		return nil, fmt.Errorf("static_s3: turso database URL is empty")
	}
	if cfg.Timeout <= 0 {
		cfg.Timeout = DefaultTursoTimeout
	}
	opts := []libsql.Option{}
	if cfg.AuthToken != "" {
		opts = append(opts, libsql.WithAuthToken(cfg.AuthToken))
	}
	connector, err := libsql.NewConnector(cfg.DatabaseURL, opts...)
	if err != nil {
		return nil, fmt.Errorf("static_s3: turso connector error: %w", err)
	}
	db := sql.OpenDB(connector)
	db.SetMaxOpenConns(8)
	db.SetMaxIdleConns(2)
	db.SetConnMaxIdleTime(30 * time.Second)
	return db, nil
}

// tursoSchemaDDL bootstraps the Turso read-replica schema. It is deliberately
// minimal — a materialized read model of the serving blob tree only. It does
// NOT mirror the PostgreSQL schema, and it never stores file contents.
//
// site_deployments.seq is a per-site monotonic "activation order" token. It
// guarantees that a stale replication job can never overwrite the pointer of a
// newer active deployment, even when it finishes later.
const tursoSchemaDDL = `
CREATE TABLE IF NOT EXISTS site_deployments (
    site_id       TEXT PRIMARY KEY,
    deployment_id TEXT NOT NULL,
    version       INTEGER NOT NULL,
    seq           INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS blob_tree_entries (
    deployment_id TEXT NOT NULL,
    path          TEXT NOT NULL,
    blob_hash     TEXT NOT NULL,
    PRIMARY KEY (deployment_id, path)
);

CREATE INDEX IF NOT EXISTS idx_blob_tree_deployment
    ON blob_tree_entries(deployment_id);

CREATE TABLE IF NOT EXISTS replication_seq (
    id        INTEGER PRIMARY KEY CHECK (id = 1),
    next_seq  INTEGER NOT NULL
);
INSERT OR IGNORE INTO replication_seq (id, next_seq) VALUES (1, 1);
`

// EnsureTursoSchema creates the read-replica tables if they do not exist.
// Idempotent and safe to run on every startup, by both the read-only
// blob-server and the API replicator.
func EnsureTursoSchema(ctx context.Context, db *sql.DB) error {
	_, err := db.ExecContext(ctx, tursoSchemaDDL)
	if err != nil {
		return fmt.Errorf("static_s3: turso schema init error: %w", err)
	}
	return nil
}
