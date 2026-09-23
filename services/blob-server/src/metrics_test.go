package cdx_s3

import (
	"context"
	"errors"
	"sync"
	"testing"
	"time"
)

// fakeSink records RedisOps in memory, mirroring what the real Redis sink does.
// It lets the aggregation logic be tested without a live Redis.
type fakeSink struct {
	mu       sync.Mutex
	hashes   map[string]map[string]int64
	counters map[string]int64
	err      error
	batches  int
}

func newFakeSink() *fakeSink {
	return &fakeSink{
		hashes:   map[string]map[string]int64{},
		counters: map[string]int64{},
	}
}

func (f *fakeSink) Apply(_ context.Context, ops []RedisOp) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.batches++
	for _, op := range ops {
		switch op.Kind {
		case opHIncrBy:
			if f.hashes[op.Key] == nil {
				f.hashes[op.Key] = map[string]int64{}
			}
			f.hashes[op.Key][op.Field] += op.Delta
		case opIncrBy:
			f.counters[op.Key] += op.Delta
		}
	}
	return f.err
}

func (f *fakeSink) hash(key, field string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.hashes[key][field]
}

func (f *fakeSink) counter(key string) int64 {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.counters[key]
}

func TestStatusClassField(t *testing.T) {
	tests := map[int]string{
		200: "status_2xx",
		204: "status_2xx",
		301: "status_3xx",
		304: "status_3xx",
		404: "status_4xx",
		500: "status_5xx",
		503: "status_5xx",
	}
	for code, want := range tests {
		if got := statusClassField(code); got != want {
			t.Errorf("statusClassField(%d) = %q, want %q", code, got, want)
		}
	}
}

func TestLatencyBucketFieldsCumulative(t *testing.T) {
	// 75ms belongs to every cumulative bound >= 75.
	got := latencyBucketFields(75)
	want := []string{"latency_le_100", "latency_le_250", "latency_le_500", "latency_le_1000", "latency_le_2500"}
	if len(got) != len(want) {
		t.Fatalf("latencyBucketFields(75) = %v, want %v", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("latencyBucketFields(75) = %v, want %v", got, want)
		}
	}

	// A slow request above the largest bound lands in no cumulative bucket.
	if fields := latencyBucketFields(5000); len(fields) != 0 {
		t.Fatalf("latencyBucketFields(5000) = %v, want none", fields)
	}

	// Negative/zero is clamped to the fastest bucket.
	if fields := latencyBucketFields(-1); len(fields) != len(latencyBoundsMs) {
		t.Fatalf("latencyBucketFields(-1) = %v, want all bounds", fields)
	}
}

func TestBuildMetricOpsAggregation(t *testing.T) {
	ts := time.Date(2026, 9, 23, 14, 5, 0, 0, time.UTC)
	metric := RequestMetric{
		SiteID:       "site-1",
		DeploymentID: "dep-1",
		StatusCode:   200,
		BytesSent:    4096,
		DurationMs:   75,
		CacheHit:     true,
		Timestamp:    ts,
	}

	key := "metrics:site-1:202609231405"
	sink := newFakeSink()
	if err := sink.Apply(context.Background(), BuildMetricOps(metric)); err != nil {
		t.Fatalf("Apply error: %v", err)
	}

	if got := sink.hash(key, "requests"); got != 1 {
		t.Errorf("requests = %d, want 1", got)
	}
	if got := sink.hash(key, "status_2xx"); got != 1 {
		t.Errorf("status_2xx = %d, want 1", got)
	}
	if got := sink.hash(key, "bytes"); got != 4096 {
		t.Errorf("bytes = %d, want 4096", got)
	}
	if got := sink.hash(key, "latency_sum_ms"); got != 75 {
		t.Errorf("latency_sum_ms = %d, want 75", got)
	}
	if got := sink.hash(key, "cache_hits"); got != 1 {
		t.Errorf("cache_hits = %d, want 1", got)
	}
	if got := sink.hash(key, "cache_misses"); got != 0 {
		t.Errorf("cache_misses = %d, want 0", got)
	}
	if got := sink.hash(key, "latency_le_100"); got != 1 {
		t.Errorf("latency_le_100 = %d, want 1", got)
	}
	if got := sink.hash(key, "latency_le_50"); got != 0 {
		t.Errorf("latency_le_50 = %d, want 0 (75ms > 50ms)", got)
	}
	if sink.batches != 1 {
		t.Errorf("expected a single batched sink call, got %d", sink.batches)
	}
}

func TestBuildMetricOpsCacheMiss(t *testing.T) {
	metric := RequestMetric{SiteID: "site-2", StatusCode: 404, BytesSent: 100, Timestamp: time.Now()}
	sink := newFakeSink()
	_ = sink.Apply(context.Background(), BuildMetricOps(metric))
	key := metricsBucketKey("site-2", metric.Timestamp)
	if got := sink.hash(key, "cache_misses"); got != 1 {
		t.Errorf("cache_misses = %d, want 1", got)
	}
	if got := sink.hash(key, "cache_hits"); got != 0 {
		t.Errorf("cache_hits = %d, want 0", got)
	}
	if got := sink.hash(key, "status_4xx"); got != 1 {
		t.Errorf("status_4xx = %d, want 1", got)
	}
}

func TestBuildMetricOpsNoSite(t *testing.T) {
	if ops := BuildMetricOps(RequestMetric{StatusCode: 200}); ops != nil {
		t.Fatalf("expected no ops without a site id, got %v", ops)
	}
}

func TestBuildUsageOpsHourBucketing(t *testing.T) {
	t1 := time.Date(2026, 9, 23, 14, 1, 0, 0, time.UTC)
	t2 := time.Date(2026, 9, 23, 14, 59, 0, 0, time.UTC) // same hour
	t3 := time.Date(2026, 9, 23, 15, 0, 0, 0, time.UTC)  // next hour

	sink := newFakeSink()
	for _, m := range []struct {
		bytes int64
		ts    time.Time
	}{{1024, t1}, {2048, t2}, {512, t3}} {
		if err := sink.Apply(context.Background(), BuildUsageOps("site-1", m.bytes, m.ts)); err != nil {
			t.Fatalf("Apply error: %v", err)
		}
	}

	if got := sink.counter("usage:bw:site-1:2026092314"); got != 3072 {
		t.Errorf("14:00 bucket = %d, want 3072 (same-hour accumulation)", got)
	}
	if got := sink.counter("usage:bw:site-1:2026092315"); got != 512 {
		t.Errorf("15:00 bucket = %d, want 512", got)
	}
}

func TestBuildUsageOpsRejectsNonPositive(t *testing.T) {
	for _, bytes := range []int64{0, -5} {
		if ops := BuildUsageOps("site-1", bytes, time.Now()); ops != nil {
			t.Fatalf("expected no ops for %d bytes, got %v", bytes, ops)
		}
	}
	if ops := BuildUsageOps("", 100, time.Now()); ops != nil {
		t.Fatalf("expected no ops without a site id, got %v", ops)
	}
}

func TestParseBucketKeys(t *testing.T) {
	siteID, bucket, ok := parseMetricsBucketKey("metrics:abc:202609231405")
	if !ok || siteID != "abc" || !bucket.Equal(time.Date(2026, 9, 23, 14, 5, 0, 0, time.UTC)) {
		t.Fatalf("parseMetricsBucketKey failed: %q %v %v", siteID, bucket, ok)
	}
	if _, _, ok := parseMetricsBucketKey("metrics:abc:not-a-time"); ok {
		t.Fatal("expected invalid metrics bucket to fail")
	}

	siteID, bucket, ok = parseUsageBucketKey("usage:bw:abc:2026092314")
	if !ok || siteID != "abc" || !bucket.Equal(time.Date(2026, 9, 23, 14, 0, 0, 0, time.UTC)) {
		t.Fatalf("parseUsageBucketKey failed: %q %v %v", siteID, bucket, ok)
	}
	if _, _, ok := parseUsageBucketKey("usage:bw:abc"); ok {
		t.Fatal("expected short usage key to fail")
	}
}

func TestMetricsAggregatorSinkFailureDoesNotPanic(t *testing.T) {
	// A Redis/backend failure must be swallowed — the serving path must never
	// observe it.
	sink := newFakeSink()
	sink.err = errors.New("redis down")

	agg := NewMetricsAggregator(sink)
	agg.RecordMetric(RequestMetric{SiteID: "site-1", StatusCode: 200, Timestamp: time.Now()})
	agg.RecordBandwidth("site-1", 1024, time.Now())

	if sink.batches != 2 {
		t.Fatalf("expected both records to reach the sink, got %d calls", sink.batches)
	}
}

func TestMetricsAggregatorNilSinkIsSafe(t *testing.T) {
	var agg *MetricsAggregator
	agg.RecordMetric(RequestMetric{SiteID: "site-1"})
	agg.RecordBandwidth("site-1", 1024, time.Now())

	empty := NewMetricsAggregator(nil)
	empty.RecordMetric(RequestMetric{SiteID: "site-1"})
	empty.RecordBandwidth("site-1", 1024, time.Now())
}

func TestMetricsAggregatorStampsTimestamp(t *testing.T) {
	sink := newFakeSink()
	agg := NewMetricsAggregator(sink)
	fixed := time.Date(2026, 1, 2, 3, 4, 0, 0, time.UTC)
	agg.now = func() time.Time { return fixed }

	agg.RecordMetric(RequestMetric{SiteID: "site-1", StatusCode: 200})

	if got := sink.hash("metrics:site-1:202601020304", "requests"); got != 1 {
		t.Fatalf("expected metric stamped with aggregator clock, got %d", got)
	}
}

// TestProcessEventRecordsMetricsAndUsage verifies a single analytics event
// feeds both the operational metrics bucket and the (separate) bandwidth usage
// bucket. The legacy Redis pipeline is skipped by leaving redis nil.
func TestProcessEventRecordsMetricsAndUsage(t *testing.T) {
	sink := newFakeSink()
	a := &AnalyticsMiddleware{aggregator: NewMetricsAggregator(sink)}

	ts := time.Date(2026, 9, 23, 14, 5, 0, 0, time.UTC)
	a.processEvent(analyticsEvent{
		siteID:       "site-1",
		deploymentID: "dep-1",
		statusCode:   206,
		bytesSent:    8192,
		durationMs:   120,
		cacheHit:     true,
		timestamp:    ts,
	})

	if got := sink.hash("metrics:site-1:202609231405", "requests"); got != 1 {
		t.Errorf("metrics requests = %d, want 1", got)
	}
	if got := sink.hash("metrics:site-1:202609231405", "status_2xx"); got != 1 {
		t.Errorf("metrics status_2xx = %d, want 1", got)
	}
	if got := sink.hash("metrics:site-1:202609231405", "cache_hits"); got != 1 {
		t.Errorf("metrics cache_hits = %d, want 1", got)
	}
	if got := sink.hash("metrics:site-1:202609231405", "latency_le_250"); got != 1 {
		t.Errorf("metrics latency_le_250 = %d, want 1", got)
	}
	if got := sink.counter("usage:bw:site-1:2026092314"); got != 8192 {
		t.Errorf("usage bandwidth = %d, want 8192", got)
	}
	// Usage must never carry request counts.
	if got := sink.hash("usage:bw:site-1:2026092314", "requests"); got != 0 {
		t.Errorf("usage should not count requests, got %d", got)
	}
}

// TestRecordNeverBlocksWhenChannelFull proves the serving path cannot be
// blocked by a full analytics channel.
func TestRecordNeverBlocksWhenChannelFull(t *testing.T) {
	a := &AnalyticsMiddleware{eventCh: make(chan analyticsEvent, 1)}
	a.eventCh <- analyticsEvent{siteID: "already-full"}

	done := make(chan struct{})
	go func() {
		a.Record(RequestMetric{SiteID: "site-1", StatusCode: 200})
		close(done)
	}()

	select {
	case <-done:
	case <-time.After(time.Second):
		t.Fatal("Record blocked on a full channel")
	}
}
