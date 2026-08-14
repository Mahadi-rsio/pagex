package cdx_s3

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"strings"
	"sync"
	"sync/atomic"
	"time"
)

// BlobTreeStore resolves the active deployment's serving tree (path → blob
// hash) for a site. Implementations must return an empty map with a nil error
// when the site simply has no deployable tree, so the caller knows to fall
// through the read chain.
type BlobTreeStore interface {
	GetBlobTree(ctx context.Context, siteID string) (map[string]string, error)
}

// ─── Turso read-replica error classification ────────────────────────────────

// TursoErrorKind classifies a Turso read-replica failure so the caller can
// decide the fallback and log enough context to debug — without ever logging
// credentials.
type TursoErrorKind uint8

const (
	TursoErrConnection TursoErrorKind = iota
	TursoErrAuth
	TursoErrTimeout
	TursoErrQuery
	TursoErrMissing
)

func (k TursoErrorKind) String() string {
	switch k {
	case TursoErrConnection:
		return "connection"
	case TursoErrAuth:
		return "auth"
	case TursoErrTimeout:
		return "timeout"
	case TursoErrQuery:
		return "query"
	case TursoErrMissing:
		return "missing"
	default:
		return "unknown"
	}
}

// TursoError wraps an underlying error with a classification. Error() never
// includes the auth token or any database credential.
type TursoError struct {
	Kind TursoErrorKind
	Err  error
}

func (e *TursoError) Error() string {
	if e.Err != nil {
		return fmt.Sprintf("turso %s: %v", e.Kind, e.Err)
	}
	return fmt.Sprintf("turso %s", e.Kind)
}

func (e *TursoError) Unwrap() error { return e.Err }

// classifyTursoError attaches a TursoErrorKind to a raw driver error. Both
// timeout and connection failures eventually fall back to PostgreSQL; the
// classification only refines the log/metric signal.
func classifyTursoError(err error) error {
	if err == nil {
		return nil
	}
	var te *TursoError
	if errors.As(err, &te) {
		return te
	}
	switch {
	case errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled):
		return &TursoError{Kind: TursoErrTimeout, Err: err}
	}
	msg := strings.ToLower(err.Error())
	switch {
	case strings.Contains(msg, "context deadline exceeded") ||
		strings.Contains(msg, "client.timeout") ||
		strings.Contains(msg, "i/o timeout"):
		return &TursoError{Kind: TursoErrTimeout, Err: err}
	case strings.Contains(msg, "401") || strings.Contains(msg, "unauthorized") ||
		strings.Contains(msg, "403") || strings.Contains(msg, "forbidden"):
		return &TursoError{Kind: TursoErrAuth, Err: err}
	case strings.Contains(msg, "connection refused") ||
		strings.Contains(msg, "no such host") ||
		strings.Contains(msg, "dial tcp") ||
		strings.Contains(msg, "connect: network is unreachable") ||
		strings.Contains(msg, "failed to connect") ||
		strings.Contains(msg, "unexpected eof"):
		return &TursoError{Kind: TursoErrConnection, Err: err}
	default:
		return &TursoError{Kind: TursoErrQuery, Err: err}
	}
}

// ─── TursoBlobTreeStore ─────────────────────────────────────────────────────

// TursoBlobTreeStore serves the blob tree from the Turso read replica. It is a
// read-only consumer: writes happen only on the API side via replication.
type TursoBlobTreeStore struct {
	db      *sql.DB
	timeout time.Duration
}

// NewTursoBlobTreeStore wraps a libSQL handle with a per-query timeout.
func NewTursoBlobTreeStore(db *sql.DB, timeout time.Duration) *TursoBlobTreeStore {
	if timeout <= 0 {
		timeout = DefaultTursoTimeout
	}
	return &TursoBlobTreeStore{db: db, timeout: timeout}
}

// GetBlobTree resolves site_id → active deployment → path→blob_hash map in
// two reads. "Missing site" returns a TursoErrMissing classification (the
// caller falls back to PostgreSQL); transport/query errors are classified so
// the caller can also fall back instead of failing the request.
func (s *TursoBlobTreeStore) GetBlobTree(ctx context.Context, siteID string) (map[string]string, error) {
	qctx, cancel := context.WithTimeout(ctx, s.timeout)
	defer cancel()

	var deploymentID string
	err := s.db.QueryRowContext(qctx,
		`SELECT deployment_id FROM site_deployments WHERE site_id = ?`,
		siteID,
	).Scan(&deploymentID)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, &TursoError{Kind: TursoErrMissing, Err: fmt.Errorf("no deployment for site %s", siteID)}
		}
		return nil, classifyTursoError(err)
	}

	rows, err := s.db.QueryContext(qctx,
		`SELECT path, blob_hash FROM blob_tree_entries WHERE deployment_id = ?`,
		deploymentID,
	)
	if err != nil {
		return nil, classifyTursoError(err)
	}
	defer rows.Close()

	entries := make(map[string]string)
	for rows.Next() {
		var path, hash string
		if err := rows.Scan(&path, &hash); err != nil {
			return nil, classifyTursoError(err)
		}
		entries[path] = hash
	}
	if err := rows.Err(); err != nil {
		return nil, classifyTursoError(err)
	}
	return entries, nil
}

// ─── PostgreSQLBlobTreeStore ────────────────────────────────────────────────

// PostgreSQLBlobTreeStore serves the blob tree straight from PostgreSQL — the
// source of truth. It preserves the exact historical query and semantics.
type PostgreSQLBlobTreeStore struct {
	db *sql.DB
}

// NewPostgreSQLBlobTreeStore wraps the PostgreSQL handle.
func NewPostgreSQLBlobTreeStore(db *sql.DB) *PostgreSQLBlobTreeStore {
	return &PostgreSQLBlobTreeStore{db: db}
}

// GetBlobTree executes the canonical active-deployment tree query.
func (s *PostgreSQLBlobTreeStore) GetBlobTree(ctx context.Context, siteID string) (map[string]string, error) {
	if s.db == nil {
		return nil, fmt.Errorf("static_s3: multi-tenant mode requires db_dsn")
	}

	rows, err := s.db.QueryContext(ctx, `
		SELECT bte.path, bte.blob_hash
		FROM blob_tree_entries bte
		INNER JOIN deployments d ON d.id = bte.deployment_id
		WHERE d.is_active = true AND d.site_id = $1
	`, siteID)
	if err != nil {
		return nil, fmt.Errorf("static_s3: blob tree query error: %w", err)
	}
	defer rows.Close()

	entries := make(map[string]string)
	for rows.Next() {
		var path, hash string
		if err := rows.Scan(&path, &hash); err != nil {
			return nil, fmt.Errorf("static_s3: blob tree scan error: %w", err)
		}
		entries[path] = hash
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("static_s3: blob tree rows error: %w", err)
	}
	return entries, nil
}

// ─── Read-chain resolver ────────────────────────────────────────────────────

// blobTreeSource identifies which backend produced a blob tree.
type blobTreeSource string

const (
	blobTreeSourceTurso    blobTreeSource = "turso"
	blobTreeSourcePostgres blobTreeSource = "postgres"
)

// blobTreeResolver walks the read chain: Turso (when configured) then
// PostgreSQL. Any Turso failure — connection, auth, timeout, missing site,
// query error — falls back to PostgreSQL. It is the component tested in
// isolation by unit tests.
type blobTreeResolver struct {
	turso BlobTreeStore
	pg    BlobTreeStore
	m     *blobTreeMetrics
	log   *log.Logger
}

// Get returns the active blob tree along with the backend that produced it.
// A PostgreSQL error propagates to the request (the existing 500 path); a
// Turso error never does.
func (r *blobTreeResolver) Get(ctx context.Context, siteID string) (map[string]string, blobTreeSource, error) {
	if r.turso != nil {
		start := time.Now()
		entries, err := r.turso.GetBlobTree(ctx, siteID)
		latency := time.Since(start)
		if err == nil {
			if len(entries) == 0 {
				r.m.incTursoEmpty()
				r.logf("source=turso site=%s entries=0 latency=%s empty, falling back to postgres", siteID, latency)
			} else {
				r.m.incTursoHit()
				r.m.observeTursoLatency(latency)
				r.logf("source=turso site=%s entries=%d latency=%s", siteID, len(entries), latency)
				return entries, blobTreeSourceTurso, nil
			}
		} else {
			r.m.incTursoError()
			r.m.observeTursoLatency(latency)
			r.logf("source=turso site=%s error=%s latency=%s falling back to postgres", siteID, err, latency)
		}
	}

	if r.pg == nil {
		return nil, "", fmt.Errorf("static_s3: multi-tenant mode requires db_dsn")
	}
	r.m.incPostgresFallback()
	entries, err := r.pg.GetBlobTree(ctx, siteID)
	if err != nil {
		return nil, "", err
	}
	r.logf("source=postgres site=%s entries=%d", siteID, len(entries))
	return entries, blobTreeSourcePostgres, nil
}

func (r *blobTreeResolver) logf(format string, args ...interface{}) {
	if r.log != nil {
		r.log.Printf(format, args...)
	}
}

// ─── Metrics ────────────────────────────────────────────────────────────────

// blobTreeMetrics tracks read-chain behavior. The blob-server has no Prometheus
// exporter today, so the counters live in-process and a summary is emitted on
// shutdown via Cleanup; request logging itself is performance-sensitive and
// stays minimal.
type blobTreeMetrics struct {
	redisHit         uint64
	tursoHit         uint64
	tursoEmpty       uint64
	tursoError       uint64
	postgresFallback uint64

	mu               sync.Mutex
	tursoLatencyTotal time.Duration
	tursoLatencyCount uint64
}

func newBlobTreeMetrics() *blobTreeMetrics {
	return &blobTreeMetrics{}
}

func (m *blobTreeMetrics) incRedisHit()         { atomic.AddUint64(&m.redisHit, 1) }
func (m *blobTreeMetrics) incTursoHit()         { atomic.AddUint64(&m.tursoHit, 1) }
func (m *blobTreeMetrics) incTursoEmpty()       { atomic.AddUint64(&m.tursoEmpty, 1) }
func (m *blobTreeMetrics) incTursoError()       { atomic.AddUint64(&m.tursoError, 1) }
func (m *blobTreeMetrics) incPostgresFallback() { atomic.AddUint64(&m.postgresFallback, 1) }

func (m *blobTreeMetrics) observeTursoLatency(d time.Duration) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.tursoLatencyTotal += d
	m.tursoLatencyCount++
}

// Snapshot renders the metric counters for shutdown logging.
func (m *blobTreeMetrics) Snapshot() string {
	m.mu.Lock()
	defer m.mu.Unlock()
	avg := time.Duration(0)
	if m.tursoLatencyCount > 0 {
		avg = m.tursoLatencyTotal / time.Duration(m.tursoLatencyCount)
	}
	return fmt.Sprintf(
		"blob_tree_redis_hit=%d blob_tree_turso_hit=%d blob_tree_turso_empty=%d "+
			"turso_error=%d blob_tree_postgres_fallback=%d turso_latency_avg=%s",
		atomic.LoadUint64(&m.redisHit),
		atomic.LoadUint64(&m.tursoHit),
		atomic.LoadUint64(&m.tursoEmpty),
		atomic.LoadUint64(&m.tursoError),
		atomic.LoadUint64(&m.postgresFallback),
		avg,
	)
}