package cdx_s3

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/redis/go-redis/v9"
)

// ─── Operational metrics vs customer usage ────────────────────────────────────
//
// PageX keeps two deliberately separate concepts:
//
//	Metrics — operational/observability data (request counts, status classes,
//	          latency, cache hit/miss). Aggregated in short Redis time buckets
//	          and flushed to service_metrics_hourly. NEVER used for billing.
//
//	Usage   — the customer-billable/quota resource. Requests are UNLIMITED on
//	          every plan, so the only usage resource is bandwidth_bytes. It is
//	          accumulated in its own Redis namespace and flushed to
//	          bandwidth_usage_hourly. It never contains a request count.
//
// Both are recorded from the async analytics channel, so serving a website is
// never blocked by Redis or PostgreSQL. The exact same operation batch is used
// in production and in unit tests.
const (
	// metricsBucketFormat is a 1-minute bucket: metrics:{site_id}:{YYYYMMDDHHmm}.
	metricsBucketFormat = "200601021504"
	// usageBucketFormat is a 1-hour bucket: usage:bw:{site_id}:{YYYYMMDDHH}.
	usageBucketFormat = "2006010215"

	// metricsBucketTTL keeps a few hours of minute buckets so the flusher can
	// drain them even if it is briefly unavailable.
	metricsBucketTTL = 3 * time.Hour
	// usageBucketTTL keeps unflushed billable bandwidth for two days.
	usageBucketTTL = 48 * time.Hour

	// MetricsKeyPrefix is the Redis namespace for operational metrics.
	MetricsKeyPrefix = "metrics"
	// UsageKeyPrefix is the Redis namespace for bandwidth usage.
	UsageKeyPrefix = "usage:bw"
	// UsageFieldName is the Redis hash/string payload that carries bandwidth.
	UsageFieldName = "bandwidth_bytes"
)

// latencyBoundsMs are cumulative histogram upper bounds. A request with
// duration d increments every bound >= d (Prometheus-style cumulative buckets),
// which lets the API estimate p50/p95/p99 from counts alone.
var latencyBoundsMs = []int64{50, 100, 250, 500, 1000, 2500}

// RequestMetric is the authoritative per-request operational metric measured at
// the blob-serving layer. Values are never trusted from the frontend.
type RequestMetric struct {
	TenantID     string
	SiteID       string
	DeploymentID string
	StatusCode   int
	BytesSent    int64
	DurationMs   int64
	CacheHit     bool
	UserAgent    string
	IP           string
	Timestamp    time.Time
}

// ─── Redis operation batch ────────────────────────────────────────────────────

type redisOpKind int

const (
	opHIncrBy redisOpKind = iota
	opIncrBy
	opExpire
)

// RedisOp is a single, transport-agnostic Redis counter mutation. Keeping the
// aggregation as data (instead of direct client calls) makes it unit-testable
// without a live Redis and lets one pipeline carry the whole batch atomically.
type RedisOp struct {
	Kind  redisOpKind
	Key   string
	Field string
	Delta int64
	TTL   time.Duration
}

// MetricsSink applies a batch of RedisOps. Implementations must be safe for
// concurrent use and must never block the serving path.
type MetricsSink interface {
	Apply(ctx context.Context, ops []RedisOp) error
}

// RedisMetricsSink executes RedisOps against a Redis client via a single
// pipeline. Errors are returned so callers can ignore them.
type RedisMetricsSink struct {
	client *redis.Client
}

func NewRedisMetricsSink(client *redis.Client) *RedisMetricsSink {
	return &RedisMetricsSink{client: client}
}

func (s *RedisMetricsSink) Apply(ctx context.Context, ops []RedisOp) error {
	if s == nil || s.client == nil || len(ops) == 0 {
		return nil
	}
	pipe := s.client.Pipeline()
	for _, op := range ops {
		switch op.Kind {
		case opHIncrBy:
			pipe.HIncrBy(ctx, op.Key, op.Field, op.Delta)
		case opIncrBy:
			pipe.IncrBy(ctx, op.Key, op.Delta)
		case opExpire:
			pipe.Expire(ctx, op.Key, op.TTL)
		}
	}
	_, err := pipe.Exec(ctx)
	return err
}

// ─── Key / bucket helpers ─────────────────────────────────────────────────────

// metricsBucketKey returns metrics:{site_id}:{YYYYMMDDHHmm} (UTC).
func metricsBucketKey(siteID string, t time.Time) string {
	return fmt.Sprintf("%s:%s:%s", MetricsKeyPrefix, siteID, t.UTC().Format(metricsBucketFormat))
}

// usageBucketKey returns usage:bw:{site_id}:{YYYYMMDDHH} (UTC).
func usageBucketKey(siteID string, t time.Time) string {
	return fmt.Sprintf("%s:%s:%s", UsageKeyPrefix, siteID, t.UTC().Format(usageBucketFormat))
}

// statusClassField maps an HTTP status code to its operational bucket field.
func statusClassField(code int) string {
	switch {
	case code >= 500:
		return "status_5xx"
	case code >= 400:
		return "status_4xx"
	case code >= 300:
		return "status_3xx"
	default:
		return "status_2xx"
	}
}

// latencyBucketFields returns the cumulative histogram fields a request with
// the given duration belongs to (every bound >= duration).
func latencyBucketFields(ms int64) []string {
	if ms < 0 {
		ms = 0
	}
	fields := make([]string, 0, len(latencyBoundsMs))
	for _, bound := range latencyBoundsMs {
		if ms <= bound {
			fields = append(fields, fmt.Sprintf("latency_le_%d", bound))
		}
	}
	return fields
}

// parseMetricsBucketKey parses metrics:{site_id}:{YYYYMMDDHHmm}.
func parseMetricsBucketKey(key string) (siteID string, bucket time.Time, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 3 || parts[0] != MetricsKeyPrefix {
		return "", time.Time{}, false
	}
	t, err := time.ParseInLocation(metricsBucketFormat, parts[2], time.UTC)
	if err != nil {
		return "", time.Time{}, false
	}
	return parts[1], t.UTC(), true
}

// parseUsageBucketKey parses usage:bw:{site_id}:{YYYYMMDDHH}.
func parseUsageBucketKey(key string) (siteID string, bucket time.Time, ok bool) {
	parts := strings.Split(key, ":")
	if len(parts) != 4 || parts[0] != "usage" || parts[1] != "bw" {
		return "", time.Time{}, false
	}
	t, err := time.ParseInLocation(usageBucketFormat, parts[3], time.UTC)
	if err != nil {
		return "", time.Time{}, false
	}
	return parts[2], t.UTC(), true
}

// ─── Operation builders (pure, unit-tested) ───────────────────────────────────

// BuildMetricOps converts a request metric into the RedisOps that aggregate it
// into its 1-minute operational bucket.
func BuildMetricOps(m RequestMetric) []RedisOp {
	if m.SiteID == "" {
		return nil
	}
	ts := m.Timestamp
	if ts.IsZero() {
		ts = time.Now()
	}
	key := metricsBucketKey(m.SiteID, ts)

	ops := []RedisOp{
		{Kind: opHIncrBy, Key: key, Field: "requests", Delta: 1},
		{Kind: opHIncrBy, Key: key, Field: statusClassField(m.StatusCode), Delta: 1},
		{Kind: opHIncrBy, Key: key, Field: "bytes", Delta: m.BytesSent},
		{Kind: opHIncrBy, Key: key, Field: "latency_sum_ms", Delta: m.DurationMs},
	}
	if m.CacheHit {
		ops = append(ops, RedisOp{Kind: opHIncrBy, Key: key, Field: "cache_hits", Delta: 1})
	} else {
		ops = append(ops, RedisOp{Kind: opHIncrBy, Key: key, Field: "cache_misses", Delta: 1})
	}
	for _, field := range latencyBucketFields(m.DurationMs) {
		ops = append(ops, RedisOp{Kind: opHIncrBy, Key: key, Field: field, Delta: 1})
	}
	ops = append(ops, RedisOp{Kind: opExpire, Key: key, TTL: metricsBucketTTL})
	return ops
}

// BuildUsageOps converts served response bytes into the RedisOps that
// accumulate billable bandwidth in its hourly bucket. Requests are deliberately
// NOT represented here — only bandwidth_bytes is usage.
func BuildUsageOps(siteID string, bytes int64, t time.Time) []RedisOp {
	if siteID == "" || bytes <= 0 {
		return nil
	}
	if t.IsZero() {
		t = time.Now()
	}
	key := usageBucketKey(siteID, t)
	return []RedisOp{
		{Kind: opIncrBy, Key: key, Delta: bytes},
		{Kind: opExpire, Key: key, TTL: usageBucketTTL},
	}
}

// ─── Aggregator ───────────────────────────────────────────────────────────────

// MetricsAggregator records metrics and bandwidth usage through a MetricsSink.
// Every call is best-effort: a sink failure is swallowed so a Redis outage can
// never surface on the serving path.
type MetricsAggregator struct {
	sink MetricsSink
	now  func() time.Time
}

func NewMetricsAggregator(sink MetricsSink) *MetricsAggregator {
	return &MetricsAggregator{sink: sink, now: time.Now}
}

// RecordMetric aggregates one request into its operational bucket.
func (a *MetricsAggregator) RecordMetric(m RequestMetric) {
	if a == nil || a.sink == nil {
		return
	}
	if m.Timestamp.IsZero() {
		m.Timestamp = a.now()
	}
	_ = a.sink.Apply(context.Background(), BuildMetricOps(m))
}

// RecordBandwidth aggregates served response bytes into the usage bucket.
func (a *MetricsAggregator) RecordBandwidth(siteID string, bytes int64, t time.Time) {
	if a == nil || a.sink == nil {
		return
	}
	ops := BuildUsageOps(siteID, bytes, t)
	if len(ops) == 0 {
		return
	}
	_ = a.sink.Apply(context.Background(), ops)
}
