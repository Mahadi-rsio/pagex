package cdx_s3

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
)

// usageTracker is the in-process replacement for the removed Vector pipeline.
//
// It tails the Caddy JSON access log (the same one Vector used to read), parses
// each line, aggregates the per-request counters per site+hour bucket over short
// windows, and POSTs pre-aggregated records to the console usage-ingest endpoint
// (`POST /internal/usage/ingest`, bearer-token auth). The API owns the schema and
// dedupes retried batches via a deterministic ingest_id, so the tracker never
// double-counts on restart or retry.
//
// The tracker performs no direct database access — only the HTTP ingest call.
//
// It is memory-conscious and safe to run inside the Caddy process: a single
// goroutine owns both tailing and aggregation, the flush interval is short, and
// a failed POST simply keeps the pending counts in memory until the next attempt.

type usageConfig struct {
	Enabled    bool
	LogPath    string
	LogDir     string
	Checkpoint string
	APIURL     string
	Token      string
	FlushEvery time.Duration
	IdleAfter  time.Duration
	HTTPClient *http.Client
}

func defaultUsageConfig() usageConfig {
	return usageConfig{
		LogPath:    "/var/log/caddy/access.log",
		LogDir:     "/var/log/caddy",
		Checkpoint: "/var/log/caddy/.usage-checkpoint",
		APIURL:     "http://localhost:3000/internal/usage/ingest",
		FlushEvery: 30 * time.Second,
		IdleAfter:  90 * time.Second,
		HTTPClient: &http.Client{Timeout: 15 * time.Second},
	}
}

// usageConfigFromEnv builds a usageConfig from environment variables. The
// tracker is only enabled when USAGE_INGEST_TOKEN is set (and the API URL is
// non-empty).
func usageConfigFromEnv() usageConfig {
	cfg := defaultUsageConfig()
	cfg.Token = os.Getenv("USAGE_INGEST_TOKEN")
	if url := os.Getenv("USAGE_API_URL"); url != "" {
		cfg.APIURL = url
	}
	if v := os.Getenv("USAGE_LOG_PATH"); v != "" {
		cfg.LogPath = v
	}
	if v := os.Getenv("USAGE_LOG_DIR"); v != "" {
		cfg.LogDir = v
	}
	if v := os.Getenv("USAGE_CHECKPOINT"); v != "" {
		cfg.Checkpoint = v
	}
	if v := os.Getenv("USAGE_FLUSH_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			cfg.FlushEvery = time.Duration(ms) * time.Millisecond
		}
	}
	if v := os.Getenv("USAGE_IDLE_MS"); v != "" {
		if ms, err := strconv.Atoi(v); err == nil && ms > 0 {
			cfg.IdleAfter = time.Duration(ms) * time.Millisecond
		}
	}
	cfg.Enabled = cfg.Token != "" && cfg.APIURL != ""
	return cfg
}

// newUsageTracker builds a tracker from the given config. A nil logger is
// tolerated (the tracker degrades to silent operation).
func newUsageTracker(cfg usageConfig, logger *zap.Logger) *usageTracker {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &usageTracker{
		cfg:     cfg,
		logger:  logger,
		agg:     make(map[string]*usageAgg),
		last:    make(map[string]time.Time),
		pending: make(map[string]*usageAgg),
	}
}

// usageSingleton guards a single shared usage tracker so that multiple
// static_s3 handler instances (one per `static_s3` site block in the Caddyfile)
// never run competing tailers over the same access log. The tracker is only
// started when USAGE_INGEST_TOKEN is set; otherwise sharedUsageTracker returns
// a nil tracker and acquisition is a no-op.
var (
	usageSingle      *usageTracker
	usageSingleOnce  sync.Once
	usageRefs        int
	usageAcquireMu   sync.Mutex
	usageShutdownNow sync.Once
)

// acquireUsageTracker returns the process-wide usage tracker, starting it on
// first use. Every non-nil result must be matched by a call to
// releaseUsageTracker.
func acquireUsageTracker(logger *zap.Logger) *usageTracker {
	usageAcquireMu.Lock()
	defer usageAcquireMu.Unlock()

	cfg := usageConfigFromEnv()
	if !cfg.Enabled {
		return nil
	}
	usageSingleOnce.Do(func() {
		usageSingle = newUsageTracker(cfg, logger)
		usageSingle.start()
	})
	usageRefs++
	return usageSingle
}

// releaseUsageTracker stops the shared tracker once the last reference is
// released. It is idempotent and safe to call with a nil tracker.
func releaseUsageTracker(t *usageTracker) {
	if t == nil {
		return
	}
	usageAcquireMu.Lock()
	usageRefs--
	if usageRefs <= 0 && usageSingle != nil {
		usageShutdownNow.Do(func() {
			usageSingle.stop()
		})
	}
	usageAcquireMu.Unlock()
}

// usageTracker implements the tailing + aggregation + flush pipeline.
type usageTracker struct {
	cfg    usageConfig
	logger *zap.Logger

	agg  map[string]*usageAgg // key: siteID|hourBucket
	mu   sync.Mutex
	last map[string]time.Time // key: siteID|hourBucket → last update

	// pending holds aggregates that failed to POST and are awaiting retry.
	pending map[string]*usageAgg

	done chan struct{}
	once sync.Once
	wg   sync.WaitGroup
}

type usageAgg struct {
	siteID      string
	bucket      string
	bandwidth   int64
	requests    int64
	status2xx   int64
	status3xx   int64
	status4xx   int64
	status5xx   int64
	cacheHits   int64
	cacheMisses int64
	latencySum  int64
	latency50   int64
	latency100  int64
	latency250  int64
	latency500  int64
	latency1000 int64
	latency2500 int64
}

func newUsageAgg(siteID, bucket string) *usageAgg {
	return &usageAgg{siteID: siteID, bucket: bucket}
}

func (a *usageAgg) add(l lineStats) {
	a.bandwidth += l.bytes
	a.requests++
	switch {
	case l.status >= 500:
		a.status5xx++
	case l.status >= 400:
		a.status4xx++
	case l.status >= 300:
		a.status3xx++
	case l.status >= 200:
		a.status2xx++
	}
	if l.cacheHit {
		a.cacheHits++
	} else {
		a.cacheMisses++
	}
	a.latencySum += l.durationMs
	switch {
	case l.durationMs <= 50:
		a.latency50++
		a.latency100++
		a.latency250++
		a.latency500++
		a.latency1000++
		a.latency2500++
	case l.durationMs <= 100:
		a.latency100++
		a.latency250++
		a.latency500++
		a.latency1000++
		a.latency2500++
	case l.durationMs <= 250:
		a.latency250++
		a.latency500++
		a.latency1000++
		a.latency2500++
	case l.durationMs <= 500:
		a.latency500++
		a.latency1000++
		a.latency2500++
	case l.durationMs <= 1000:
		a.latency1000++
		a.latency2500++
	case l.durationMs <= 2500:
		a.latency2500++
	}
}

// lineStats is the parsed view of a single Caddy access-log JSON line, matching
// the fields the Vector remap transform used to extract.
type lineStats struct {
	siteID       string
	deploymentID string
	status       int
	bytes        int64
	durationMs   int64
	cacheHit     bool
	hourBucket   string
}

// rawLogLine mirrors the subset of Caddy's JSON access-log entry we parse.
type rawLogLine struct {
	Ts           float64 `json:"ts"`
	Status       int     `json:"status"`
	Size         int64   `json:"size"`
	Duration     float64 `json:"duration"`
	SiteID       string  `json:"site_id"`
	DeploymentID string  `json:"deployment_id"`
	CacheHit     bool    `json:"cache_hit"`
}

// start launches the tracker goroutine. It must be called exactly once per
// tracker; it is a no-op if the tracker is not enabled.
func (t *usageTracker) start() {
	if t == nil || !t.cfg.Enabled {
		return
	}
	t.once.Do(func() {
		t.done = make(chan struct{})
		t.wg.Add(1)
		go t.run()
		t.logger.Info("static_s3: usage tracker started",
			zap.String("log_path", t.cfg.LogPath),
			zap.String("api_url", t.cfg.APIURL),
			zap.Duration("flush_every", t.cfg.FlushEvery))
	})
}

// stop signals the tracker to shut down and waits for it to finish, flushing
// any remaining aggregates. It is safe to call multiple times.
func (t *usageTracker) stop() {
	if t == nil || !t.cfg.Enabled {
		return
	}
	if t.done == nil {
		return
	}
	select {
	case <-t.done:
		return
	default:
		close(t.done)
	}
	t.wg.Wait()
}

// run is the main loop: it tails the access log and periodically flushes.
func (t *usageTracker) run() {
	defer t.wg.Done()

	// Recover the tail offset from the checkpoint file if present.
	offset := t.loadOffset()

	ticker := time.NewTicker(t.cfg.FlushEvery)
	defer ticker.Stop()

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	lines := make(chan lineStats, 4096)
	tailDone := make(chan struct{})

	t.wg.Add(1)
	go func() {
		defer t.wg.Done()
		defer close(tailDone)
		t.tail(ctx, offset, lines)
	}()

	for {
		select {
		case <-t.done:
			cancel()
			<-tailDone
			t.flushAll()
			return
		case ls, ok := <-lines:
			if !ok {
				lines = nil
				continue
			}
			t.accumulate(ls)
		case <-ticker.C:
			t.flushDue(time.Now())
		}
	}
}

// tail follows the access log from the given byte offset, emitting parsed lines.
// It handles rotation by inode and resumes reading the previous file when it is
// rotated away before returning to the current one.
func (t *usageTracker) tail(ctx context.Context, offset int64, out chan<- lineStats) {
	for {
		if err := ctx.Err(); err != nil {
			return
		}
		file, info, err := openLog(t.cfg.LogPath)
		if err != nil {
			if t.sleepCtx(ctx, 2*time.Second) {
				return
			}
			continue
		}

		// read_from: end on first open (no checkpoint) — skip pre-existing lines
		// so we don't re-ingest the past hour. Establish a real byte offset so
		// subsequent re-opens resume exactly where we left off (never re-seeking
		// to end, which would drop lines appended between reads).
		if offset < 0 {
			end, err := file.Seek(0, io.SeekEnd)
			if err != nil {
				file.Close()
				return
			}
			offset = end
		} else if offset > 0 {
			if _, err := file.Seek(offset, io.SeekStart); err != nil {
				file.Close()
				return
			}
		}

		fileInfo := info

		scanner := bufio.NewScanner(file)
		scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)

		// Only update the checkpoint with file bytes we have fully emitted.
		var consumed int64

		for scanner.Scan() {
			select {
			case <-ctx.Done():
				file.Close()
				t.saveOffset(offset, consumed)
				return
			default:
			}

			line := scanner.Text()
			consumed += int64(len(line)) + 1 // +1 for the newline

			if ls, ok := parseLogLine(line); ok {
				select {
				case out <- ls:
				case <-ctx.Done():
					file.Close()
					t.saveOffset(offset, consumed)
					return
				}
			}

			// Detect rotation: if the current path no longer points at the same
			// inode we opened, break out and re-open (which picks up the newest).
			if cur, err := os.Stat(t.cfg.LogPath); err == nil && !os.SameFile(cur, fileInfo) {
				break
			}
		}

		t.saveOffset(offset, consumed)
		offset += consumed
		file.Close()

		if t.sleepCtx(ctx, time.Second) {
			return
		}
	}
}

func (t *usageTracker) sleepCtx(ctx context.Context, d time.Duration) bool {
	select {
	case <-ctx.Done():
		return true
	case <-time.After(d):
		return false
	}
}

// accumulate folds a parsed line into the per-site+hour aggregate.
func (t *usageTracker) accumulate(ls lineStats) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.agg == nil {
		t.agg = make(map[string]*usageAgg)
		t.last = make(map[string]time.Time)
		t.pending = make(map[string]*usageAgg)
	}
	key := ls.siteID + "|" + ls.hourBucket
	a := t.agg[key]
	if a == nil {
		a = newUsageAgg(ls.siteID, ls.hourBucket)
		t.agg[key] = a
	}
	a.add(ls)
	t.last[key] = time.Now()
}

// flushDue POSTs the deltas accumulated since the previous flush for every live
// bucket, then resets them so each window carries distinct counts (and a
// distinct deterministic ingest_id). Buckets that have gone idle are removed.
func (t *usageTracker) flushDue(now time.Time) {
	t.mu.Lock()
	var due []*usageAgg
	for key, a := range t.agg {
		last := t.last[key]
		if now.Sub(last) >= t.cfg.IdleAfter {
			due = append(due, a)
			delete(t.agg, key)
			delete(t.last, key)
			continue
		}
		// Emit the delta since the last flush, then keep the bucket alive with
		// zeroed counters so later events continue into the same bucket.
		cp := *a
		*a = *newUsageAgg(a.siteID, a.bucket)
		due = append(due, &cp)
	}
	t.mu.Unlock()

	if len(due) > 0 {
		t.post(due)
	}
}

// flushAll is called on shutdown; it drains every bucket regardless of idle.
func (t *usageTracker) flushAll() {
	t.mu.Lock()
	var all []*usageAgg
	for _, a := range t.agg {
		all = append(all, a)
	}
	t.agg = make(map[string]*usageAgg)
	t.last = make(map[string]time.Time)
	t.mu.Unlock()
	if len(all) > 0 {
		t.post(all)
	}
}

// post sends a batch of records to the ingest endpoint as NDJSON. On failure it
// keeps the records in the pending set for a later retry.
func (t *usageTracker) post(records []*usageAgg) {
	if len(records) == 0 {
		return
	}
	body := t.encodeNDJSON(records)
	req, err := http.NewRequest(http.MethodPost, t.cfg.APIURL, bytes.NewReader(body))
	if err != nil {
		t.logger.Error("static_s3: usage: build request failed", zap.Error(err))
		return
	}
	req.Header.Set("Content-Type", "application/x-ndjson")
	req.Header.Set("Authorization", "Bearer "+t.cfg.Token)

	resp, err := t.cfg.HTTPClient.Do(req)
	if err != nil {
		t.logger.Warn("static_s3: usage: ingest request failed", zap.Error(err))
		t.requeue(records)
		return
	}
	defer resp.Body.Close()
	_, _ = io.Copy(io.Discard, resp.Body)

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		t.logger.Debug("static_s3: usage: ingested", zap.Int("records", len(records)))
		return
	}
	t.logger.Warn("static_s3: usage: ingest returned non-2xx",
		zap.Int("status", resp.StatusCode), zap.Int("records", len(records)))
	t.requeue(records)
}

// requeue holds records that failed to POST so they can be retried on the next
// flush. To keep memory bounded, records older than the checkpoint window are
// eventually dropped rather than accumulated without limit.
func (t *usageTracker) requeue(records []*usageAgg) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if t.pending == nil {
		t.pending = make(map[string]*usageAgg)
	}
	for _, a := range records {
		key := a.siteID + "|" + a.bucket
		existing := t.pending[key]
		if existing == nil {
			t.pending[key] = a
			continue
		}
		// Merge into the existing pending record.
		existing.bandwidth += a.bandwidth
		existing.requests += a.requests
		existing.status2xx += a.status2xx
		existing.status3xx += a.status3xx
		existing.status4xx += a.status4xx
		existing.status5xx += a.status5xx
		existing.cacheHits += a.cacheHits
		existing.cacheMisses += a.cacheMisses
		existing.latencySum += a.latencySum
		existing.latency50 += a.latency50
		existing.latency100 += a.latency100
		existing.latency250 += a.latency250
		existing.latency500 += a.latency500
		existing.latency1000 += a.latency1000
		existing.latency2500 += a.latency2500
	}
}

// encodeNDJSON serializes records into the NDJSON body the ingest API accepts.
func (t *usageTracker) encodeNDJSON(records []*usageAgg) []byte {
	var buf bytes.Buffer
	for _, a := range records {
		rec := ingestRecord{
			IngestID:       ingestID(a),
			SiteID:         a.siteID,
			Bucket:         a.bucket,
			BandwidthBytes: a.bandwidth,
			Requests:       a.requests,
			Status2xx:      a.status2xx,
			Status3xx:      a.status3xx,
			Status4xx:      a.status4xx,
			Status5xx:      a.status5xx,
			CacheHits:      a.cacheHits,
			CacheMisses:    a.cacheMisses,
			LatencySumMS:   a.latencySum,
			LatencyLe50:    a.latency50,
			LatencyLe100:   a.latency100,
			LatencyLe250:   a.latency250,
			LatencyLe500:   a.latency500,
			LatencyLe1000:  a.latency1000,
			LatencyLe2500:  a.latency2500,
		}
		b, err := json.Marshal(rec)
		if err != nil {
			continue
		}
		buf.Write(b)
		buf.WriteByte('\n')
	}
	return buf.Bytes()
}

// ingestRecord is the wire shape sent to POST /internal/usage/ingest.
type ingestRecord struct {
	IngestID       string `json:"ingest_id"`
	SiteID         string `json:"site_id"`
	Bucket         string `json:"bucket"`
	BandwidthBytes int64  `json:"bandwidth_bytes"`
	Requests       int64  `json:"requests"`
	Status2xx      int64  `json:"status_2xx"`
	Status3xx      int64  `json:"status_3xx"`
	Status4xx      int64  `json:"status_4xx"`
	Status5xx      int64  `json:"status_5xx"`
	CacheHits      int64  `json:"cache_hits"`
	CacheMisses    int64  `json:"cache_misses"`
	LatencySumMS   int64  `json:"latency_sum_ms"`
	LatencyLe50    int64  `json:"latency_le_50"`
	LatencyLe100   int64  `json:"latency_le_100"`
	LatencyLe250   int64  `json:"latency_le_250"`
	LatencyLe500   int64  `json:"latency_le_500"`
	LatencyLe1000  int64  `json:"latency_le_1000"`
	LatencyLe2500  int64  `json:"latency_le_2500"`
}

// ingestID builds the deterministic idempotency key, matching the Vector remap:
// "v1|site|bucket|requests|bytes|2xx|3xx|4xx|5xx".
func ingestID(a *usageAgg) string {
	return "v1|" + a.siteID + "|" + a.bucket + "|" +
		strconv.FormatInt(a.requests, 10) + "|" + strconv.FormatInt(a.bandwidth, 10) + "|" +
		strconv.FormatInt(a.status2xx, 10) + "|" + strconv.FormatInt(a.status3xx, 10) + "|" +
		strconv.FormatInt(a.status4xx, 10) + "|" + strconv.FormatInt(a.status5xx, 10)
}

// parseLogLine parses one Caddy access-log JSON line into lineStats. Lines with
// an empty site_id are skipped (matching Vector's `abort`). The hour bucket is
// derived in UTC from the log timestamp.
func parseLogLine(line string) (lineStats, bool) {
	var raw rawLogLine
	if err := json.Unmarshal([]byte(line), &raw); err != nil {
		return lineStats{}, false
	}
	if raw.SiteID == "" {
		return lineStats{}, false
	}

	ts := raw.Ts
	if ts <= 0 {
		ts = float64(time.Now().Unix())
	}
	t := time.Unix(int64(ts), 0).UTC()

	bytes := raw.Size
	if bytes < 0 {
		bytes = 0
	}
	durationMs := int64(raw.Duration * 1000.0)
	if durationMs < 0 {
		durationMs = 0
	}

	return lineStats{
		siteID:       raw.SiteID,
		deploymentID: raw.DeploymentID,
		status:       raw.Status,
		bytes:        bytes,
		durationMs:   durationMs,
		cacheHit:     raw.CacheHit,
		hourBucket:   t.Format("2006-01-02T15:00:00Z"),
	}, true
}

// openLog opens the current access log, creating the parent directory if needed.
func openLog(path string) (*os.File, os.FileInfo, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	info, err := f.Stat()
	if err != nil {
		f.Close()
		return nil, nil, err
	}
	return f, info, nil
}

// loadOffset reads the persisted byte offset from the checkpoint file. A missing
// or unparsable checkpoint returns -1 (meaning: start from the end of the log).
func (t *usageTracker) loadOffset() int64 {
	data, err := os.ReadFile(t.cfg.Checkpoint)
	if err != nil {
		return -1
	}
	v, err := strconv.ParseInt(strings.TrimSpace(string(data)), 10, 64)
	if err != nil {
		return -1
	}
	if v < 0 {
		return -1
	}
	return v
}

// saveOffset persists the byte offset to the checkpoint file, best-effort.
func (t *usageTracker) saveOffset(base, consumed int64) {
	if t.cfg.Checkpoint == "" {
		return
	}
	dir := filepath.Dir(t.cfg.Checkpoint)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return
	}
	data := []byte(strconv.FormatInt(base+consumed, 10))
	if tmp, err := os.CreateTemp(dir, ".usage-checkpoint-*"); err == nil {
		_, _ = tmp.Write(data)
		_ = tmp.Close()
		_ = os.Rename(tmp.Name(), t.cfg.Checkpoint)
	}
}
