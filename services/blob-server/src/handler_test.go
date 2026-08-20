package cdx_s3

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
)

func testPluginWithWarmManifest(t *testing.T, depID string, files map[string]string) *StaticPlugin {
	t.Helper()
	p := &StaticPlugin{
		Bucket:        "test-bucket",
		BaseDomain:    "localhost",
		Fallback:      "index.html",
		cacheTTL:      time.Minute,
		maxCacheSize:  1 << 20,
		cache:         NewLRUCache(1024, 1<<20),
		manifestCache: NewManifestLRUCache(16),
		metrics:       &ServeMetrics{},
	}
	// Warm the L1 manifest cache. Everything downstream must resolve from memory.
	p.populateManifestCaches(depID, &DeploymentManifest{
		Version:      manifestSchemaVersion,
		DeploymentID: depID,
		Files:        files,
	})
	return p
}

func TestWarmCacheHotPathZeroExternal(t *testing.T) {
	const depID = "dep-warm"
	const siteID = "site-warm"
	const version = "7"

	p := testPluginWithWarmManifest(t, depID, map[string]string{
		"index.html":    "aaaa11111111111111111111111111111111111111111111111111111111111111",
		"index.html.br":  "bbbb22222222222222222222222222222222222222222222222222222222222222",
		"logo.png":       "cccc33333333333333333333333333333333333333333333333333333333333333",
		"logo.png.webp":  "dddd44444444444444444444444444444444444444444444444444444444444444",
	})

	// Warm active-deployment L1 (siteID:__active__:version).
	p.cacheActiveDeployment(siteID, version, depID)

	// Warm subdomain→siteID L1 so tenant resolution is also memory-only.
	p.cacheSiteID("site-warm", siteID)

	// Warm the version L1 so all version-scoped keys line up.
	p.cache.Set("site-warm:__version__", &CacheItem{
		Key:     "site-warm:__version__",
		Content: []byte(version),
		Exists:  true,
	}, time.Minute)

	// Warm path-resolution LRU entries (skip manifest + Redis on hot path).
	p.cache.Set("site-warm:7:/:raw", &CacheItem{
		Key:         "site-warm:7:/:raw",
		BlobHash:    "aaaa11111111111111111111111111111111111111111111111111111111111111",
		ContentType: "text/html",
		FilePath:    "index.html",
		Exists:      true,
	}, time.Minute)
	p.cache.Set("site-warm:7:/:br", &CacheItem{
		Key:             "site-warm:7:/:br",
		BlobHash:        "bbbb22222222222222222222222222222222222222222222222222222222222222",
		ContentType:     "text/html",
		ContentEncoding: "br",
		FilePath:        "index.html",
		Exists:          true,
	}, time.Minute)

	// Warm blob body cache for the requested paths.
	body := []byte("<h1>hi</h1>")
	p.cache.Set("site-warm:7:/:raw:body", &CacheItem{
		Key:     "site-warm:7:/:raw:body",
		ETag:    `"etag-1"`,
		Size:    int64(len(body)),
		Content: body,
		Exists:  true,
	}, time.Minute)
	p.cache.Set("site-warm:7:/:br:body", &CacheItem{
		Key:             "site-warm:7:/:br:body",
		ETag:            `"etag-br"`,
		Size:            int64(len(body)),
		Content:         body,
		ContentEncoding: "br",
		ContentType:     "text/html",
		FilePath:        "index.html",
		Exists:          true,
	}, time.Minute)

	// No redis, no db, no s3 clients — any fallthrough would fail loudly.
	p.redisClient = nil
	p.db = nil
	p.s3Client = nil

	do := func(r *http.Request) *httptest.ResponseRecorder {
		rr := httptest.NewRecorder()
		rec := caddyhttp.NewResponseRecorder(rr, nil, nil)
		if err := p.ServeHTTP(rec, r, nil); err != nil {
			t.Fatalf("ServeHTTP error: %v", err)
		}
		rec.WriteResponse()
		return rr
	}

	// Raw HTML request — path cache + body cache hit, zero external calls.
	req := httptest.NewRequest("GET", "http://site-warm.localhost/", nil)
	req.Host = "site-warm.localhost"
	rr := do(req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rr.Code)
	}
	if got := rr.Header().Get("Content-Type"); !strings.Contains(got, "text/html") {
		t.Fatalf("expected text/html content type, got %q", got)
	}
	if p.metrics.BlobCacheHit != 1 {
		t.Fatalf("expected blob cache hit, metrics=%+v", p.metrics)
	}
	if p.metrics.ManifestL1Hit != 0 {
		t.Fatalf("path cache should short-circuit manifest lookup, metrics=%+v", p.metrics)
	}

	// Br-negotiated request.
	reqBr := httptest.NewRequest("GET", "http://site-warm.localhost/", nil)
	reqBr.Host = "site-warm.localhost"
	reqBr.Header.Set("Accept-Encoding", "br, gzip")
	rrBr := do(reqBr)
	if rrBr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", rrBr.Code)
	}
	if got := rrBr.Header().Get("Content-Encoding"); got != "br" {
		t.Fatalf("expected Content-Encoding br, got %q", got)
	}
	if got := rrBr.Header().Get("Vary"); got != "Accept-Encoding" {
		t.Fatalf("expected Vary Accept-Encoding, got %q", got)
	}
}

func TestActiveDeploymentL1VersionScoped(t *testing.T) {
	p := &StaticPlugin{
		cacheTTL: time.Minute,
		cache:    NewLRUCache(1024, 1<<20),
	}

	// Seed L1 under version "5".
	p.cacheActiveDeployment("site-1", "5", "dep-5")
	got, _ := p.cache.Get(activeDeploymentL1Key("site-1", "5"))
	if got == nil || string(got.Content) != "dep-5" {
		t.Fatalf("expected L1 hit for dep-5, got %+v", got)
	}

	// Version bump (deploy/rollback) must make the old entry unreachable.
	if _, ok := p.cache.Get(activeDeploymentL1Key("site-1", "6")); ok {
		t.Fatal("version 6 must not hit the version-5 L1 entry")
	}
}

func TestActiveDeploymentL1Negative(t *testing.T) {
	p := &StaticPlugin{
		cacheTTL: time.Minute,
		cache:    NewLRUCache(1024, 1<<20),
	}
	p.cacheActiveDeploymentNegative("site-empty", "1")

	// With nil db/redis, a negative L1 hit must return "" without error.
	id, err := p.resolveActiveDeploymentID(t.Context(), "site-empty", "1")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if id != "" {
		t.Fatalf("expected no active deployment, got %q", id)
	}
}

func TestManifestMissingNegativeCache(t *testing.T) {
	// A missing manifest must fail fast and NOT stampede MinIO.
	p := &StaticPlugin{
		metrics: &ServeMetrics{},
	}
	_ = p  // metrics used via loadManifest path below

	// Simulate a failed remote load (e.g. NoSuchKey) and record the error.
	loadErr := errors.New("NoSuchKey: manifest object missing")
	manifestErrors.Store("dep-missing", manifestErrorEntry{err: loadErr, expiresAt: time.Now().Add(manifestLoadErrorTTL)})
	defer manifestErrors.Delete("dep-missing")

	// loadManifest must return the cached error immediately, without touching
	// redis/minio (both nil — would panic).
	_, err := p.loadManifest(t.Context(), "dep-missing")
	if err == nil {
		t.Fatal("expected negative-cached error")
	}
	if !strings.Contains(err.Error(), "NoSuchKey") {
		t.Fatalf("unexpected error: %v", err)
	}
	if p.metrics.ManifestLoadErrors != 1 {
		t.Fatalf("expected load error metric, got %+v", p.metrics)
	}
}

func TestServeCachedContentWebpVary(t *testing.T) {
	p := &StaticPlugin{}

	item := &CacheItem{
		Key:         "x",
		ETag:        `"webp-etag"`,
		Size:        4,
		ContentType: "image/webp",
		FilePath:    "logo.png.webp",
		Content:     []byte("data"),
		Exists:      true,
	}

	req := httptest.NewRequest("GET", "http://localhost/logo.png", nil)
	rr := httptest.NewRecorder()
	if err := p.serveCachedContent(rr, req, item); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got := rr.Header().Get("Vary"); got != "Accept" {
		t.Fatalf("expected Vary: Accept for webp, got %q", got)
	}
	if got := rr.Header().Get("Content-Type"); got != "image/webp" {
		t.Fatalf("expected image/webp content type, got %q", got)
	}
	if got := rr.Header().Get("Cache-Control"); got != "max-age=604800" {
		t.Fatalf("expected media cache-control, got %q", got)
	}
}

func TestResolveBlobManifestServing(t *testing.T) {
	const depID = "dep-1"
	const siteID = "site-1"

	rawIndex := "aaaa11111111111111111111111111111111111111111111111111111111111111"
	brIndex := "bbbb22222222222222222222222222222222222222222222222222222222222222"
	rawJS := "cccc33333333333333333333333333333333333333333333333333333333333333"
	gzJS := "dddd44444444444444444444444444444444444444444444444444444444444444"

	p := testPluginWithWarmManifest(t, depID, map[string]string{
		"index.html":       rawIndex,
		"index.html.br":    brIndex,
		"assets/app.js":    rawJS,
		"assets/app.js.gz": gzJS,
	})
	p.cacheActiveDeployment(siteID, "1", depID)

	req := httptest.NewRequest("GET", "http://site-1.localhost/assets/app.js", nil)
	req.Host = "site-1.localhost"
	req.Header.Set("Accept-Encoding", "gzip")

	res, err := p.resolveBlob(t.Context(), siteID, "1", "/assets/app.js", req)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res == nil {
		t.Fatal("expected resolved blob")
	}
	if res.BlobHash != gzJS {
		t.Fatalf("expected gzip variant hash, got %q", res.BlobHash)
	}
	if res.ContentEncoding != "gzip" {
		t.Fatalf("expected gzip encoding, got %q", res.ContentEncoding)
	}

	// Tenant isolation: even a malformed path can only resolve to blobs owned
	// by this tenant's manifest — never another tenant's blob or a raw blob key.
	req2 := httptest.NewRequest("GET", "http://site-1.localhost/../secret", nil)
	req2.Host = "site-1.localhost"
	res2, err := p.resolveBlob(t.Context(), siteID, "1", "/../secret", req2)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if res2 == nil {
		t.Fatal("expected SPA fallback to the tenant's own index.html")
	}
	if res2.BlobHash != rawIndex {
		t.Fatalf("resolved blob must be owned by the tenant's manifest, got %q", res2.BlobHash)
	}
}

func TestConcurrentWarmManifestLoad(t *testing.T) {
	const depID = "dep-concurrent"
	files := map[string]string{
		"index.html": "aaaa11111111111111111111111111111111111111111111111111111111111111",
	}
	p := testPluginWithWarmManifest(t, depID, files)

	var wg sync.WaitGroup
	for i := 0; i < 100; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			m, err := p.loadManifest(t.Context(), depID)
			if err != nil {
				t.Errorf("unexpected error: %v", err)
				return
			}
			if m.DeploymentID != depID {
				t.Errorf("wrong manifest: %s", m.DeploymentID)
			}
		}()
	}
	wg.Wait()
}