package cdx_s3

import (
	"bufio"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"
)

func mustStats(t *testing.T, line string) lineStats {
	t.Helper()
	ls, ok := parseLogLine(line)
	if !ok {
		t.Fatalf("parseLogLine(%q) returned not-ok", line)
	}
	return ls
}

func TestParseLogLineBasic(t *testing.T) {
	ls := mustStats(t, `{"ts":1700000000,"status":200,"size":1234,"duration":0.25,"site_id":"site-a","deployment_id":"dep-1","cache_hit":true}`)

	if ls.siteID != "site-a" {
		t.Errorf("siteID = %q, want site-a", ls.siteID)
	}
	if ls.deploymentID != "dep-1" {
		t.Errorf("deploymentID = %q, want dep-1", ls.deploymentID)
	}
	if ls.status != 200 {
		t.Errorf("status = %d, want 200", ls.status)
	}
	if ls.bytes != 1234 {
		t.Errorf("bytes = %d, want 1234", ls.bytes)
	}
	if ls.durationMs != 250 {
		t.Errorf("durationMs = %d, want 250", ls.durationMs)
	}
	if !ls.cacheHit {
		t.Error("cacheHit = false, want true")
	}
	if ls.hourBucket != "2023-11-14T22:00:00Z" {
		t.Errorf("hourBucket = %q, want 2023-11-14T22:00:00Z", ls.hourBucket)
	}
}

func TestParseLogLineSkipsEmptySite(t *testing.T) {
	if _, ok := parseLogLine(`{"ts":1700000000,"status":404,"site_id":"","size":0}`); ok {
		t.Error("expected line with empty site_id to be skipped")
	}
}

func TestParseLogLineSkipsNonJSON(t *testing.T) {
	if _, ok := parseLogLine(`not json`); ok {
		t.Error("expected non-JSON line to be skipped")
	}
}

func TestParseLogLineClampsNegative(t *testing.T) {
	ls := mustStats(t, `{"ts":1700000000,"status":200,"size":-5,"duration":-1,"site_id":"site-a"}`)
	if ls.bytes != 0 {
		t.Errorf("bytes = %d, want clamped 0", ls.bytes)
	}
	if ls.durationMs != 0 {
		t.Errorf("durationMs = %d, want clamped 0", ls.durationMs)
	}
}

func TestParseLogLineUsesNowForMissingTs(t *testing.T) {
	ls := mustStats(t, `{"status":200,"size":10,"site_id":"site-a"}`)
	// hourBucket must parse to a valid UTC hour; no explicit assertion on the
	// exact value (time-dependent) beyond it being non-empty.
	if ls.hourBucket == "" {
		t.Error("expected non-empty hourBucket for missing ts")
	}
}

func TestAggAddCounters(t *testing.T) {
	a := newUsageAgg("site-a", "2023-11-14T22:00:00Z")
	a.add(lineStats{status: 200, bytes: 100, durationMs: 40, cacheHit: true, siteID: "site-a"})
	a.add(lineStats{status: 404, bytes: 50, durationMs: 200, cacheHit: false, siteID: "site-a"})
	a.add(lineStats{status: 500, bytes: 25, durationMs: 3000, cacheHit: false, siteID: "site-a"})

	if a.requests != 3 {
		t.Errorf("requests = %d, want 3", a.requests)
	}
	if a.bandwidth != 175 {
		t.Errorf("bandwidth = %d, want 175", a.bandwidth)
	}
	if a.status2xx != 1 || a.status4xx != 1 || a.status5xx != 1 {
		t.Errorf("status buckets = 2xx:%d 4xx:%d 5xx:%d, want 1 each", a.status2xx, a.status4xx, a.status5xx)
	}
	if a.cacheHits != 1 || a.cacheMisses != 2 {
		t.Errorf("cache = hits:%d misses:%d, want 1/2", a.cacheHits, a.cacheMisses)
	}
	if a.latencySum != 3240 {
		t.Errorf("latencySum = %d, want 3240", a.latencySum)
	}
	// 40ms hits le_50..le_2500; 200ms hits le_250..le_2500; 3000ms hits nothing.
	if a.latency50 != 1 {
		t.Errorf("latency_le_50 = %d, want 1", a.latency50)
	}
	if a.latency100 != 1 {
		t.Errorf("latency_le_100 = %d, want 1", a.latency100)
	}
	if a.latency250 != 2 {
		t.Errorf("latency_le_250 = %d, want 2", a.latency250)
	}
	if a.latency500 != 2 || a.latency1000 != 2 || a.latency2500 != 2 {
		t.Errorf("latency 500/1000/2500 = %d/%d/%d, want 2 each", a.latency500, a.latency1000, a.latency2500)
	}
}

func TestIngestIDDeterministic(t *testing.T) {
	a := newUsageAgg("site-a", "2023-11-14T22:00:00Z")
	a.requests = 3
	a.bandwidth = 175
	a.status2xx = 1
	a.status3xx = 0
	a.status4xx = 1
	a.status5xx = 1

	want := "v1|site-a|2023-11-14T22:00:00Z|3|175|1|0|1|1"
	if got := ingestID(a); got != want {
		t.Errorf("ingestID = %q, want %q", got, want)
	}
}

func TestEncodeNDJSON(t *testing.T) {
	tracker := newUsageTracker(usageConfig{}, nil)
	a := newUsageAgg("site-a", "2023-11-14T22:00:00Z")
	a.requests = 1
	a.bandwidth = 100
	a.status2xx = 1

	body := tracker.encodeNDJSON([]*usageAgg{a})
	var rec ingestRecord
	if err := json.Unmarshal(body, &rec); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	if rec.SiteID != "site-a" || rec.Bucket != "2023-11-14T22:00:00Z" || rec.Requests != 1 || rec.BandwidthBytes != 100 {
		t.Errorf("record mismatch: %+v", rec)
	}
	if rec.IngestID == "" {
		t.Error("expected non-empty ingest_id")
	}
}

func TestPostSendsBearerAndNDJSON(t *testing.T) {
	var gotAuth, gotCT string
	var gotBody string
	var mu sync.Mutex
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		gotAuth = r.Header.Get("Authorization")
		gotCT = r.Header.Get("Content-Type")
		b, _ := io.ReadAll(r.Body)
		gotBody = string(b)
		mu.Unlock()
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	cfg := defaultUsageConfig()
	cfg.APIURL = srv.URL
	cfg.Token = "sekret"
	cfg.HTTPClient = srv.Client()
	tracker := newUsageTracker(cfg, nil)

	a := newUsageAgg("site-a", "2023-11-14T22:00:00Z")
	a.requests = 1
	a.bandwidth = 100
	a.status2xx = 1

	tracker.post([]*usageAgg{a})

	mu.Lock()
	defer mu.Unlock()
	if gotAuth != "Bearer sekret" {
		t.Errorf("Authorization = %q, want Bearer sekret", gotAuth)
	}
	if gotCT != "application/x-ndjson" {
		t.Errorf("Content-Type = %q, want application/x-ndjson", gotCT)
	}
	if !strings.Contains(gotBody, `"site_id":"site-a"`) {
		t.Errorf("body = %q, want site_id", gotBody)
	}
}

func TestFlushDueEmitsDeltaAndKeepsBucket(t *testing.T) {
	cfg := defaultUsageConfig()
	cfg.Enabled = true
	cfg.FlushEvery = time.Hour
	cfg.IdleAfter = time.Hour
	tracker := newUsageTracker(cfg, nil)

	ls := lineStats{status: 200, bytes: 100, durationMs: 50, siteID: "site-a", hourBucket: "2023-11-14T22:00:00Z"}
	tracker.accumulate(ls)

	// First flush: the single request is emitted and the bucket is zeroed but
	// kept alive.
	now := time.Now()
	tracker.flushDue(now)

	ls2 := lineStats{status: 200, bytes: 200, durationMs: 50, siteID: "site-a", hourBucket: "2023-11-14T22:00:00Z"}
	tracker.accumulate(ls2)

	tracker.mu.Lock()
	agg := tracker.agg["site-a|2023-11-14T22:00:00Z"]
	tracker.mu.Unlock()
	if agg == nil {
		t.Fatal("bucket was removed after flush; expected it kept alive")
	}
	if agg.requests != 1 {
		t.Errorf("bucket requests after second accumulate = %d, want 1 (only the new event)", agg.requests)
	}
}

func TestScannerTokenBuffer(t *testing.T) {
	// Ensure bufio.Scanner can handle a long single JSON line by splitting on
	// newlines with a large buffer (guards the 64KiB default).
	long := `{"ts":1700000000,"status":200,"size":1,"duration":0.1,"site_id":"` +
		strings.Repeat("x", 200000) + `"}`
	sc := bufio.NewScanner(strings.NewReader(long + "\n"))
	sc.Buffer(make([]byte, 64*1024), 4*1024*1024)
	if !sc.Scan() {
		t.Fatal("expected scan to succeed")
	}
	if _, ok := parseLogLine(sc.Text()); !ok {
		t.Error("expected long line to parse")
	}
}

func TestTailReadsLinesAppendedAfterOpen(t *testing.T) {
	// Regression: with read_from:end, the tailer must establish a real byte
	// offset and resume from it on re-open. Re-seeking to end each loop would
	// drop any lines appended between reads, stalling the checkpoint at -1.
	dir := t.TempDir()
	path := filepath.Join(dir, "access.log")
	if err := os.WriteFile(path, []byte("existing\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	cfg := defaultUsageConfig()
	cfg.LogPath = path
	cfg.LogDir = dir
	cfg.Checkpoint = filepath.Join(dir, ".ckpt")
	tr := newUsageTracker(cfg, zap.NewNop())

	ctx, cancel := context.WithCancel(context.Background())
	out := make(chan lineStats, 100)
	go tr.tail(ctx, -1, out)

	time.Sleep(300 * time.Millisecond)
	f, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 3; i++ {
		if _, err := f.WriteString(`{"level":"info","ts":1,"logger":"http.log.access.log0","msg":"handled request","request":{"host":"a.localhost","uri":"/"},"status":200,"size":100,"site_id":"s1"}` + "\n"); err != nil {
			t.Fatal(err)
		}
		time.Sleep(150 * time.Millisecond)
	}
	f.Close()

	deadline := time.After(5 * time.Second)
	var got int
	for got < 3 {
		select {
		case <-out:
			got++
		case <-deadline:
			cancel()
			tr.stop()
			t.Fatalf("timed out reading appended lines; got %d, want 3", got)
		}
	}
	cancel()
	tr.stop()
	if off := tr.loadOffset(); off < 0 {
		t.Fatalf("expected checkpoint to advance past -1, got %d", off)
	}
}
