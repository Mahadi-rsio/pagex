package cdx_s3

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/tursodatabase/libsql-client-go/libsql"
	_ "modernc.org/sqlite" // test-only: enables "file:" backends for libsql-local DBs
)

// ─── Test helpers ────────────────────────────────────────────────────────────

// newTestTursoDB opens an in-memory-ish file-backed libSQL database used to
// exercise the real TursoBlobTreeStore and the replication SQL semantics
// without any network.
func newTestTursoDB(t *testing.T) *sql.DB {
	t.Helper()
	connector, err := libsql.NewConnector("file:memdb-"+t.Name()+"?mode=memory&cache=shared")
	if err != nil {
		t.Fatalf("libsql connector: %v", err)
	}
	db := sql.OpenDB(connector)
	t.Cleanup(func() { db.Close() })
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := EnsureTursoSchema(ctx, db); err != nil {
		t.Fatalf("ensure schema: %v", err)
	}
	return db
}

// replicateTree mirrors the API-side Turso write: upsert every entry in the
// deployment tree (idempotent).
func writeTreeRows(t *testing.T, db *sql.DB, deploymentID string, entries map[string]string) {
	t.Helper()
	for path, hash := range entries {
		_, err := db.Exec(`
			INSERT INTO blob_tree_entries (deployment_id, path, blob_hash)
			VALUES (?, ?, ?)
			ON CONFLICT (deployment_id, path) DO UPDATE SET blob_hash = excluded.blob_hash`,
			deploymentID, path, hash)
		if err != nil {
			t.Fatalf("write tree row: %v", err)
		}
	}
}

// setActivePointer mirrors the API-side pointer publish with the monotonic
// seq fence: an older seq can never overwrite a newer active deployment.
func setActivePointer(t *testing.T, db *sql.DB, siteID, deploymentID string, version, seq int64) error {
	t.Helper()
	_, err := db.Exec(`
		INSERT INTO site_deployments (site_id, deployment_id, version, seq)
		VALUES (?, ?, ?, ?)
		ON CONFLICT (site_id) DO UPDATE SET
			deployment_id = excluded.deployment_id,
			version       = excluded.version,
			seq           = excluded.seq
		WHERE excluded.seq >= site_deployments.seq`,
		siteID, deploymentID, version, seq)
	return err
}

func countRows(t *testing.T, db *sql.DB, query string, args ...interface{}) int {
	t.Helper()
	var n int
	if err := db.QueryRow(query, args...).Scan(&n); err != nil {
		t.Fatalf("count query: %v", err)
	}
	return n
}

type fakeStore struct {
	entries map[string]string
	err     error
	calls   int
}

func (f *fakeStore) GetBlobTree(_ context.Context, _ string) (map[string]string, error) {
	f.calls++
	return f.entries, f.err
}

func (f *fakeStore) assertNotCalled(t *testing.T, label string) {
	t.Helper()
	if f.calls != 0 {
		t.Fatalf("%s was called %d times, expected 0", label, f.calls)
	}
}

type fakeFiles struct {
	existsRet   int64
	existsErr   error
	fields      map[string]string
	existsCalls int
	hgetCalls   int
}

func (f *fakeFiles) exists(_ context.Context, _ string) (int64, error) {
	f.existsCalls++
	return f.existsRet, f.existsErr
}

func (f *fakeFiles) hget(_ context.Context, _ string, field string) (string, bool) {
	f.hgetCalls++
	v, ok := f.fields[field]
	return v, ok
}

func testRequest() *http.Request {
	return &http.Request{Header: http.Header{}}
}

// ─── TursoBlobTreeStore ─────────────────────────────────────────────────────

func TestTursoStoreGetBlobTree(t *testing.T) {
	db := newTestTursoDB(t)
	writeTreeRows(t, db, "dep-1", map[string]string{
		"index.html":        "h-html",
		"index.html.br":     "h-html-br",
		"assets/app.js":     "h-app",
		"assets/app.js.br":  "h-app-br",
		"assets/logo.png":   "h-logo",
		"assets/logo.png.webp": "h-logo-webp",
	})
	if err := setActivePointer(t, db, "site-a", "dep-1", 7, 100); err != nil {
		t.Fatalf("set pointer: %v", err)
	}

	store := NewTursoBlobTreeStore(db, time.Second)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	entries, err := store.GetBlobTree(ctx, "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if len(entries) != 6 {
		t.Fatalf("expected 6 entries, got %d: %v", len(entries), entries)
	}
	if entries["assets/logo.png.webp"] != "h-logo-webp" {
		t.Errorf("webp hash mismatch: %q", entries["assets/logo.png.webp"])
	}
	if entries["index.html.br"] != "h-html-br" {
		t.Errorf("br hash mismatch: %q", entries["index.html.br"])
	}
}

func TestTursoStoreMissingSiteFallsBack(t *testing.T) {
	db := newTestTursoDB(t) // empty schema
	store := NewTursoBlobTreeStore(db, time.Second)
	entries, err := store.GetBlobTree(context.Background(), "no-such-site")
	if err == nil {
		t.Fatalf("expected TursoErrMissing, got nil error with %d entries", len(entries))
	}
	var te *TursoError
	if !errors.As(err, &te) {
		t.Fatalf("expected *TursoError, got %T", err)
	}
	if te.Kind != TursoErrMissing {
		t.Errorf("expected kind missing, got %s", te.Kind)
	}
}

func TestTursoStoreTimeoutClassified(t *testing.T) {
	db := newTestTursoDB(t)
	store := NewTursoBlobTreeStore(db, 10*time.Millisecond)

	ctx, cancel := context.WithCancel(context.Background())
	cancel() // already-cancelled context → driver returns ctx error

	_, err := store.GetBlobTree(ctx, "site-a")
	if err == nil {
		t.Fatal("expected error from cancelled context")
	}
	var te *TursoError
	if !errors.As(err, &te) {
		t.Fatalf("expected *TursoError, got %T", err)
	}
	if te.Kind != TursoErrTimeout {
		t.Errorf("expected kind timeout, got %s", te.Kind)
	}
}

func TestTursoStoreEmptyDeployment(t *testing.T) {
	db := newTestTursoDB(t)
	// deployment exists but has no entries yet (transient mid-replication)
	if err := setActivePointer(t, db, "site-a", "dep-empty", 1, 1); err != nil {
		t.Fatalf("set pointer: %v", err)
	}
	store := NewTursoBlobTreeStore(db, time.Second)
	entries, err := store.GetBlobTree(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if len(entries) != 0 {
		t.Errorf("expected empty entries, got %v", entries)
	}
}

func TestClassifyTursoError(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want TursoErrorKind
	}{
		{"connection refused", errors.New(`dial tcp 127.0.0.1:443: connect: connection refused`), TursoErrConnection},
		{"no such host", errors.New(`dial tcp: lookup turso.dev: no such host`), TursoErrConnection},
		{"timeout deadline", context.DeadlineExceeded, TursoErrTimeout},
		{"i/o timeout", errors.New(`net/http: request canceled (Client.Timeout exceeded while awaiting headers)`), TursoErrTimeout},
		{"auth 401", errors.New(`server returned 401 Unauthorized`), TursoErrAuth},
		{"auth forbidden", errors.New(`403 Forbidden`), TursoErrAuth},
		{"generic query", errors.New(`statement failed: no such table: blob_tree_entries`), TursoErrQuery},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := classifyTursoError(tt.err)
			te, ok := got.(*TursoError)
			if !ok {
				t.Fatalf("expected *TursoError, got %T", got)
			}
			if te.Kind != tt.want {
				t.Errorf("expected %s, got %s", tt.want, te.Kind)
			}
		})
	}
}

// ─── Read-chain resolver ────────────────────────────────────────────────────

func newTestResolver(turso, pg BlobTreeStore) *blobTreeResolver {
	return &blobTreeResolver{turso: turso, pg: pg, m: newBlobTreeMetrics()}
}

func TestResolverTursoHitSkipsPostgres(t *testing.T) {
	pg := &fakeStore{entries: map[string]string{"should-not-be-read.html": "x"}}

	turso := &fakeStore{entries: map[string]string{"index.html": "h-turso"}}
	r := newTestResolver(turso, pg)

	entries, src, err := r.Get(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourceTurso {
		t.Errorf("expected turso source, got %s", src)
	}
	if entries["index.html"] != "h-turso" {
		t.Errorf("expected turso hash, got %v", entries)
	}
	if turso.calls != 1 || pg.calls != 0 {
		t.Errorf("turso.calls=%d pg.calls=%d, want 1/0", turso.calls, pg.calls)
	}
}

func TestResolverTursoEmptyFallsBackToPostgres(t *testing.T) {
	turso := &fakeStore{entries: map[string]string{}}
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	entries, src, err := r.Get(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourcePostgres {
		t.Errorf("expected postgres source, got %s", src)
	}
	if entries["index.html"] != "h-pg" {
		t.Errorf("expected pg hash, got %v", entries)
	}
	if turso.calls != 1 || pg.calls != 1 {
		t.Errorf("turso.calls=%d pg.calls=%d, want 1/1", turso.calls, pg.calls)
	}
}

func TestResolverTursoConnectionErrorFallsBackToPostgres(t *testing.T) {
	turso := &fakeStore{err: &TursoError{Kind: TursoErrConnection, Err: errors.New("connection refused")}}
	pg := &fakeStore{entries: map[string]string{"about.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	_, src, err := r.Get(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourcePostgres {
		t.Errorf("expected postgres source after turso connection failure, got %s", src)
	}
	if turso.calls != 1 || pg.calls != 1 {
		t.Errorf("turso.calls=%d pg.calls=%d, want 1/1", turso.calls, pg.calls)
	}
}

func TestResolverTursoTimeoutFallsBackToPostgres(t *testing.T) {
	turso := &fakeStore{err: &TursoError{Kind: TursoErrTimeout, Err: context.DeadlineExceeded}}
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	_, src, err := r.Get(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourcePostgres {
		t.Errorf("expected postgres source after turso timeout, got %s", src)
	}
}

func TestResolverTursoMissingFallsBackToPostgres(t *testing.T) {
	turso := &fakeStore{err: &TursoError{Kind: TursoErrMissing, Err: errors.New("no deployment")}}
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	_, src, err := r.Get(context.Background(), "site-not-in-turso")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourcePostgres {
		t.Errorf("expected postgres source after turso miss, got %s", src)
	}
}

func TestResolverTursoDisabledUsesPostgresOnly(t *testing.T) {
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(nil, pg)

	entries, src, err := r.Get(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if src != blobTreeSourcePostgres {
		t.Errorf("expected postgres source when turso disabled, got %s", src)
	}
	if entries["index.html"] != "h-pg" {
		t.Errorf("expected pg hash, got %v", entries)
	}
}

func TestResolverPostgresErrorPropagates(t *testing.T) {
	turso := &fakeStore{err: &TursoError{Kind: TursoErrTimeout, Err: context.DeadlineExceeded}}
	pg := &fakeStore{err: errors.New("static_s3: blob tree query error: connection refused")}
	r := newTestResolver(turso, pg)

	_, src, err := r.Get(context.Background(), "site-a")
	if err == nil {
		t.Fatal("expected PostgreSQL error to propagate")
	}
	if src != "" {
		t.Errorf("expected empty source on error, got %s", src)
	}
}

// ─── resolveBlob chain (Redis → Turso → PostgreSQL) ─────────────────────────

func TestResolveBlobRedisHitDoesNotQueryTursoOrPostgres(t *testing.T) {
	turso := &fakeStore{entries: map[string]string{"index.html": "h-turso"}}
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	files := &fakeFiles{
		existsRet: 1,
		fields: map[string]string{
			"index.html": "h-redis",
		},
	}
	p := &StaticPlugin{
		files:    files,
		resolver: r,
		metrics:  newBlobTreeMetrics(),
		Fallback: "index.html",
	}

	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/", testRequest())
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res == nil || res.BlobHash != "h-redis" {
		t.Fatalf("expected redis hash h-redis, got %+v", res)
	}
	if files.existsCalls != 1 {
		t.Errorf("expected 1 Exists call, got %d", files.existsCalls)
	}
	if turso.calls != 0 {
		t.Errorf("turso queried on redis hit (%d calls)", turso.calls)
	}
	if pg.calls != 0 {
		t.Errorf("postgres queried on redis hit (%d calls)", pg.calls)
	}
}

func TestResolveBlobTursoHitDoesNotQueryPostgres(t *testing.T) {
	turso := &fakeStore{entries: map[string]string{"index.html": "h-turso"}}
	pg := &fakeStore{entries: map[string]string{"index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	files := &fakeFiles{existsRet: 0}
	p := &StaticPlugin{
		files:    files,
		resolver: r,
		metrics:  newBlobTreeMetrics(),
		Fallback: "index.html",
	}

	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/", testRequest())
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res == nil || res.BlobHash != "h-turso" {
		t.Fatalf("expected turso hash h-turso, got %+v", res)
	}
	if turso.calls != 1 {
		t.Errorf("expected exactly 1 turso call, got %d", turso.calls)
	}
	if pg.calls != 0 {
		t.Errorf("postgres queried on turso hit (%d calls)", pg.calls)
	}
}

func TestResolveBlobTursoFailureFallsBackToPostgres(t *testing.T) {
	turso := &fakeStore{err: &TursoError{Kind: TursoErrConnection, Err: errors.New("connection refused")}}
	pg := &fakeStore{entries: map[string]string{"about/index.html": "h-pg"}}
	r := newTestResolver(turso, pg)

	files := &fakeFiles{existsRet: 0}
	p := &StaticPlugin{
		files:    files,
		resolver: r,
		metrics:  newBlobTreeMetrics(),
		Fallback: "index.html",
	}

	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/about", testRequest())
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res == nil || res.BlobHash != "h-pg" {
		t.Fatalf("expected pg hash h-pg after turso outage, got %+v", res)
	}
	if turso.calls != 1 || pg.calls != 1 {
		t.Errorf("turso.calls=%d pg.calls=%d, want 1/1", turso.calls, pg.calls)
	}
}

func TestResolveBlobVariantPreservedFromTurso(t *testing.T) {
	entries := map[string]string{
		"app.js":       "h-raw",
		"app.js.br":    "h-br",
		"app.js.gz":    "h-gz",
		"images/logo.png":     "h-png",
		"images/logo.png.webp": "h-webp",
	}
	turso := &fakeStore{entries: entries}
	pg := &fakeStore{}
	r := newTestResolver(turso, pg)
	files := &fakeFiles{existsRet: 0}
	p := &StaticPlugin{files: files, resolver: r, metrics: newBlobTreeMetrics(), Fallback: "index.html"}

	// br
	req := testRequest()
	req.Header.Set("Accept-Encoding", "br, gzip")
	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/app.js", req)
	if err != nil {
		t.Fatalf("br resolve: %v", err)
	}
	if res == nil || res.BlobHash != "h-br" || res.ContentEncoding != "br" {
		t.Fatalf("br: expected h-br/br, got %+v", res)
	}

	// gzip
	req = testRequest()
	req.Header.Set("Accept-Encoding", "gzip")
	res, err = p.resolveBlob(context.Background(), "site-a", "tenant-a", "/app.js", req)
	if err != nil {
		t.Fatalf("gzip resolve: %v", err)
	}
	if res == nil || res.BlobHash != "h-gz" || res.ContentEncoding != "gzip" {
		t.Fatalf("gzip: expected h-gz/gzip, got %+v", res)
	}

	// webp
	req = testRequest()
	req.Header.Set("Accept", "image/webp, */*")
	res, err = p.resolveBlob(context.Background(), "site-a", "tenant-a", "/images/logo.png", req)
	if err != nil {
		t.Fatalf("webp resolve: %v", err)
	}
	if res == nil || res.BlobHash != "h-webp" || res.FilePath != "images/logo.png.webp" {
		t.Fatalf("webp: expected h-webp/webp path, got %+v", res)
	}

	// blob hash unchanged: turso entries pass through verbatim
	if turso.calls != 3 || pg.calls != 0 {
		t.Errorf("turso.calls=%d pg.calls=%d, want 3/0", turso.calls, pg.calls)
	}
}

func TestResolveBlobSPAFallbackStillWorks(t *testing.T) {
	turso := &fakeStore{entries: map[string]string{"index.html": "h-index"}}
	pg := &fakeStore{}
	r := newTestResolver(turso, pg)
	files := &fakeFiles{existsRet: 0}
	p := &StaticPlugin{files: files, resolver: r, metrics: newBlobTreeMetrics(), Fallback: "index.html"}

	// /about has no candidate (about/index.html, about.html, about) → SPA fallback
	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/about", testRequest())
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res == nil || res.BlobHash != "h-index" || res.FilePath != "index.html" {
		t.Fatalf("expected SPA fallback h-index/index.html, got %+v", res)
	}

	// excluded extension must NOT fall back (404)
	p.FallbackExcept = []string{"js"}
	res, err = p.resolveBlob(context.Background(), "site-a", "tenant-a", "/missing.js", testRequest())
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res != nil {
		t.Fatalf("expected nil for excluded fallback path, got %+v", res)
	}
}

func TestResolveBlobCacheHitStillHonored(t *testing.T) {
	// entries from turso; encKey should be "webp" for image path
	turso := &fakeStore{entries: map[string]string{
		"images/logo.png":     "h-png",
		"images/logo.png.webp": "h-webp",
	}}
	pg := &fakeStore{}
	r := newTestResolver(turso, pg)
	files := &fakeFiles{existsRet: 0}
	p := &StaticPlugin{files: files, resolver: r, metrics: newBlobTreeMetrics(), Fallback: "index.html"}

	req := testRequest()
	req.Header.Set("Accept", "image/webp, */*")
	req.Header.Set("Accept-Encoding", "gzip")
	res, err := p.resolveBlob(context.Background(), "site-a", "tenant-a", "/images/logo.png", req)
	if err != nil {
		t.Fatalf("resolveBlob: %v", err)
	}
	if res == nil {
		t.Fatal("expected resolution")
	}
	if res.EncodingKey != "webp" {
		t.Errorf("expected encoding key webp, got %q", res.EncodingKey)
	}
}

// ─── Replication semantics (SQL expressions shared with the API side) ────────

func TestReplicationCreatesAllEntries(t *testing.T) {
	db := newTestTursoDB(t)
	entries := map[string]string{
		"index.html":    "h1",
		"index.html.br": "h2",
		"about.html":    "h3",
	}
	writeTreeRows(t, db, "dep-1", entries)
	if got := countRows(t, db, "SELECT COUNT(*) FROM blob_tree_entries WHERE deployment_id = ?", "dep-1"); got != 3 {
		t.Fatalf("expected 3 tree rows, got %d", got)
	}
	if err := setActivePointer(t, db, "site-a", "dep-1", 5, 1); err != nil {
		t.Fatalf("pointer: %v", err)
	}
	if got := countRows(t, db, "SELECT COUNT(*) FROM site_deployments"); got != 1 {
		t.Fatalf("expected 1 pointer row, got %d", got)
	}

	store := NewTursoBlobTreeStore(db, time.Second)
	got, err := store.GetBlobTree(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if len(got) != 3 || got["about.html"] != "h3" || got["index.html.br"] != "h2" {
		t.Errorf("unexpected tree: %v", got)
	}
}

func TestReplicationIdempotentRetry(t *testing.T) {
	db := newTestTursoDB(t)
	entries := map[string]string{"index.html": "h1", "index.html.br": "h2"}

	// Replicate twice (a failed job is simply retried; upserts must not corrupt).
	for i := 0; i < 2; i++ {
		writeTreeRows(t, db, "dep-1", entries)
		if err := setActivePointer(t, db, "site-a", "dep-1", 5, int64(i+1)); err != nil {
			t.Fatalf("pointer attempt %d: %v", i+1, err)
		}
	}
	if got := countRows(t, db, "SELECT COUNT(*) FROM blob_tree_entries WHERE deployment_id = ?", "dep-1"); got != 2 {
		t.Fatalf("expected 2 tree rows after retry, got %d", got)
	}

	// entry value updated on retry
	writeTreeRows(t, db, "dep-1", map[string]string{"index.html": "h1-updated"})
	var v string
	if err := db.QueryRow("SELECT blob_hash FROM blob_tree_entries WHERE deployment_id=? AND path=?", "dep-1", "index.html").Scan(&v); err != nil {
		t.Fatalf("scan: %v", err)
	}
	if v != "h1-updated" {
		t.Errorf("expected updated hash, got %q", v)
	}
}

func TestReplicationNewerDeploymentReplacesOld(t *testing.T) {
	db := newTestTursoDB(t)
	writeTreeRows(t, db, "dep-old", map[string]string{"index.html": "h-old", "old.txt": "h-old2"})
	writeTreeRows(t, db, "dep-new", map[string]string{"index.html": "h-new"})

	if err := setActivePointer(t, db, "site-a", "dep-old", 4, 1); err != nil {
		t.Fatalf("pointer old: %v", err)
	}
	if err := setActivePointer(t, db, "site-a", "dep-new", 5, 2); err != nil {
		t.Fatalf("pointer new: %v", err)
	}

	store := NewTursoBlobTreeStore(db, time.Second)
	got, err := store.GetBlobTree(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if got["index.html"] != "h-new" || len(got) != 1 {
		t.Errorf("expected to serve dep-new tree only, got %v", got)
	}
}

func TestReplicationStaleCannotOverwriteNewer(t *testing.T) {
	db := newTestTursoDB(t)
	writeTreeRows(t, db, "dep-old", map[string]string{"index.html": "h-old"})
	writeTreeRows(t, db, "dep-new", map[string]string{"index.html": "h-new"})

	// activation order: old was #1, new is #2
	if err := setActivePointer(t, db, "site-a", "dep-old", 100, 1); err != nil {
		t.Fatalf("pointer old: %v", err)
	}
	if err := setActivePointer(t, db, "site-a", "dep-new", 101, 2); err != nil {
		t.Fatalf("pointer new: %v", err)
	}

	// Late replication job for the OLD deployment re-publishes pointer with its
	// ORIGINAL stale seq (1). Must NOT overwrite dep-new.
	if err := setActivePointer(t, db, "site-a", "dep-old", 100, 1); err != nil {
		t.Fatalf("stale pointer replay: %v", err)
	}

	store := NewTursoBlobTreeStore(db, time.Second)
	got, err := store.GetBlobTree(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if got["index.html"] != "h-new" {
		t.Errorf("stale replication overwrote newer deployment: %v", got)
	}
}

func TestReplicationRollbackUsesNewSeq(t *testing.T) {
	db := newTestTursoDB(t)
	writeTreeRows(t, db, "dep-v5", map[string]string{"index.html": "h-v5"})
	writeTreeRows(t, db, "dep-v9", map[string]string{"index.html": "h-v9"})

	// network: v5 → v9
	if err := setActivePointer(t, db, "site-a", "dep-v5", 5, 1); err != nil {
		t.Fatalf("pointer v5: %v", err)
	}
	if err := setActivePointer(t, db, "site-a", "dep-v9", 9, 2); err != nil {
		t.Fatalf("pointer v9: %v", err)
	}

	// rollback to v5: this is a NEW activation event → higher seq (3) even
	// though the deployment version number (5) is older.
	if err := setActivePointer(t, db, "site-a", "dep-v5", 5, 3); err != nil {
		t.Fatalf("rollback pointer: %v", err)
	}

	store := NewTursoBlobTreeStore(db, time.Second)
	got, err := store.GetBlobTree(context.Background(), "site-a")
	if err != nil {
		t.Fatalf("GetBlobTree: %v", err)
	}
	if got["index.html"] != "h-v5" {
		t.Errorf("rollback did not switch Turso pointer to v5: %v", got)
	}
}

// ─── Misc guards ────────────────────────────────────────────────────────────

func TestOpenTursoEmptyURLRejected(t *testing.T) {
	if _, err := OpenTurso(TursoConfig{DatabaseURL: ""}); err == nil {
		t.Fatal("expected error for empty turso URL")
	}
}

func TestTursoConfiguredFromEnv(t *testing.T) {
	t.Setenv("TURSO_DATABASE_URL", "")
	if TursoConfigured() {
		t.Error("expected not configured when URL empty")
	}
	t.Setenv("TURSO_DATABASE_URL", "libsql://example.turso.io")
	if !TursoConfigured() {
		t.Error("expected configured when URL set")
	}
}

func TestBlobTreeMetricsSnapshot(t *testing.T) {
	m := newBlobTreeMetrics()
	m.incRedisHit()
	m.incTursoHit()
	m.incTursoEmpty()
	m.incTursoError()
	m.incPostgresFallback()
	m.observeTursoLatency(5 * time.Millisecond)
	s := m.Snapshot()
	for _, want := range []string{"turso_hit=1", "turso_error=1", "postgres_fallback=1", "redis_hit=1", "turso_latency_avg="} {
		if !strings.Contains(s, want) {
			t.Errorf("snapshot missing %q: %s", want, s)
		}
	}
}