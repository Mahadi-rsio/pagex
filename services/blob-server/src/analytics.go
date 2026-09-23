package cdx_s3

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/redis/go-redis/v9"
)

// analyticsEvent carries the per-request data sent over the buffered channel.
type analyticsEvent struct {
	siteID       string
	tenantID     string
	deploymentID string
	statusCode   int
	bytesSent    int64
	durationMs   int64
	cacheHit     bool
	userAgent    string
	ip           string
	timestamp    time.Time
}

// AnalyticsMiddleware collects per-site request statistics and flushes them to
// PostgreSQL every 5 minutes via a background goroutine.  Redis is used as a
// fast counter buffer.  HTTP responses are NEVER blocked — all recording is
// fully asynchronous via a buffered channel.
//
// Two independent pipelines are driven from the same event stream:
//
//   - Legacy daily stats (stats:{site_id}:{date} → site_daily_stats) are kept
//     unchanged for backward compatibility with the console usage endpoint.
//   - Operational metrics (1-minute buckets → service_metrics_hourly) and
//     billable bandwidth usage (1-hour buckets → bandwidth_usage_hourly) are
//     recorded by the MetricsAggregator.
type AnalyticsMiddleware struct {
	redis      *redis.Client
	db         *sql.DB
	aggregator *MetricsAggregator
	eventCh    chan analyticsEvent // buffered channel, capacity 100000 for high burst absorption
	flushEvery time.Duration       // default: 5 minutes
	done       chan struct{}        // graceful-shutdown signal
	wg         sync.WaitGroup      // wait for goroutines to exit
}

// NewAnalyticsMiddleware creates and starts the analytics middleware.
func NewAnalyticsMiddleware(redisClient *redis.Client, db *sql.DB) *AnalyticsMiddleware {
	a := &AnalyticsMiddleware{
		redis:      redisClient,
		db:         db,
		aggregator: NewMetricsAggregator(NewRedisMetricsSink(redisClient)),
		eventCh:    make(chan analyticsEvent, 100000), // scaled to 100,000 slots
		flushEvery: 5 * time.Minute,
		done:       make(chan struct{}),
	}
	a.start()
	return a
}

// start launches background goroutines:
//
//  1. 10 Event workers — drains the channel in parallel and writes Redis counters.
//  2. 1 Flusher        — ticks every flushEvery, reads Redis → upserts PostgreSQL.
func (a *AnalyticsMiddleware) start() {
	// ── Goroutines Group 1: 10 Event workers ──────────────────────────────
	numWorkers := 10
	for i := 0; i < numWorkers; i++ {
		a.wg.Add(1)
		go func() {
			defer a.wg.Done()
			for {
				select {
				case event := <-a.eventCh:
					a.processEvent(event)
				case <-a.done:
					// Drain remaining events before exiting so we don't lose data
					// that arrived between the shutdown signal and now.
					for {
						select {
						case event := <-a.eventCh:
							a.processEvent(event)
						default:
							return
						}
					}
				}
			}
		}()
	}

	// ── Goroutine Group 2: Flusher ────────────────────────────────────────
	a.wg.Add(1)
	go func() {
		defer a.wg.Done()
		ticker := time.NewTicker(a.flushEvery)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				a.flushToPostgres()
			case <-a.done:
				// Final flush on shutdown to capture any in-flight Redis data.
				a.flushToPostgres()
				return
			}
		}
	}()
}

// Record enqueues a request metric for asynchronous processing. This method is
// intentionally non-blocking: if the channel is full the event is silently
// dropped so that HTTP responses are never delayed. The metric carries the
// authoritative values measured at the blob-serving layer — nothing is taken
// from the client.
func (a *AnalyticsMiddleware) Record(m RequestMetric) {
	event := analyticsEvent{
		siteID:       m.SiteID,
		tenantID:     m.TenantID,
		deploymentID: m.DeploymentID,
		statusCode:   m.StatusCode,
		bytesSent:    m.BytesSent,
		durationMs:   m.DurationMs,
		cacheHit:     m.CacheHit,
		userAgent:    m.UserAgent,
		ip:           m.IP,
		timestamp:    m.Timestamp,
	}
	if event.timestamp.IsZero() {
		event.timestamp = time.Now().UTC()
	}

	select {
	case a.eventCh <- event:
	default:
		// Channel full — drop silently. Analytics loss is acceptable; latency
		// impact on HTTP responses is not.
	}
}

// processEvent is called only from the event-worker goroutines. It writes the
// legacy daily counters and forwards the event to the metrics/usage
// aggregator. All Redis errors are non-fatal.
func (a *AnalyticsMiddleware) processEvent(event analyticsEvent) {
	// ── Operational metrics + bandwidth usage (separate concepts) ─────────
	if a.aggregator != nil {
		metric := RequestMetric{
			TenantID:     event.tenantID,
			SiteID:       event.siteID,
			DeploymentID: event.deploymentID,
			StatusCode:   event.statusCode,
			BytesSent:    event.bytesSent,
			DurationMs:   event.durationMs,
			CacheHit:     event.cacheHit,
			UserAgent:    event.userAgent,
			IP:           event.ip,
			Timestamp:    event.timestamp,
		}
		a.aggregator.RecordMetric(metric)
		// Usage is bandwidth only. Requests are never billed, so no request
		// count is recorded here.
		a.aggregator.RecordBandwidth(event.siteID, event.bytesSent, event.timestamp)
	}

	a.recordLegacyDailyStats(event)
}

// recordLegacyDailyStats preserves the original stats:{site_id}:{date} pipeline
// read by GET /api/pages/usage/:domain.
func (a *AnalyticsMiddleware) recordLegacyDailyStats(event analyticsEvent) {
	if a.redis == nil {
		return
	}
	ctx := context.Background()

	day  := event.timestamp.Format("2006-01-02")
	hour := event.timestamp.Format("2006-01-02:15") // "YYYY-MM-DD:HH"

	statsKey := fmt.Sprintf("stats:%s:%s", event.siteID, day)
	uniqKey  := fmt.Sprintf("uniq:%s:%s",  event.siteID, day)
	peakKey  := fmt.Sprintf("peak:%s:%s",  event.siteID, hour)

	pipe := a.redis.Pipeline()

	// Main counters
	pipe.HIncrBy(ctx, statsKey, "requests",  1)
	pipe.HIncrBy(ctx, statsKey, "bandwidth", event.bytesSent)

	// HTTP status bucket
	switch {
	case event.statusCode >= 500:
		pipe.HIncrBy(ctx, statsKey, "requests_5xx", 1)
	case event.statusCode >= 400:
		pipe.HIncrBy(ctx, statsKey, "requests_4xx", 1)
	case event.statusCode >= 300:
		pipe.HIncrBy(ctx, statsKey, "requests_3xx", 1)
	default:
		pipe.HIncrBy(ctx, statsKey, "requests_2xx", 1)
	}

	// Bot / human classification
	if isBot(event.userAgent) {
		pipe.HIncrBy(ctx, statsKey, "bots", 1)
	} else {
		pipe.HIncrBy(ctx, statsKey, "humans", 1)
	}

	// Unique IPs via HyperLogLog (probabilistic cardinality estimator)
	pipe.PFAdd(ctx, uniqKey, event.ip)

	// Peak-hour slot counter
	pipe.Incr(ctx, peakKey)

	// TTLs — slightly longer than one day so a late flush still sees the data
	pipe.Expire(ctx, statsKey, 25*time.Hour)
	pipe.Expire(ctx, uniqKey,  25*time.Hour)
	pipe.Expire(ctx, peakKey,  49*time.Hour) // keep two days of hourly data

	// Fire and forget — errors here are non-fatal; counters may under-count
	// but HTTP serving is unaffected.
	_, _ = pipe.Exec(ctx)
}

// isBot returns true when the User-Agent string belongs to a known bot,
// crawler, headless browser, or synthetic monitoring tool.
func isBot(ua string) bool {
	ua = strings.ToLower(ua)
	botSignals := []string{
		"bot", "crawler", "spider", "curl", "wget",
		"python", "java", "go-http", "axios", "scrapy",
		"headless", "phantom", "selenium", "playwright",
		"lighthouse", "pingdom", "uptimerobot",
	}
	for _, signal := range botSignals {
		if strings.Contains(ua, signal) {
			return true
		}
	}
	return false
}

// ─── Flush: Redis → PostgreSQL ────────────────────────────────────────────────

// flushToPostgres drains the Redis buffers into PostgreSQL:
//   - legacy daily site stats → site_daily_stats
//   - operational 1-minute metric buckets → service_metrics_hourly
//   - billable 1-hour bandwidth buckets → bandwidth_usage_hourly
//
// It is called only from the single flusher goroutine so there are no
// concurrent DB writes from this path. A failure in any one stage never stops
// the others and never propagates to the serving path.
func (a *AnalyticsMiddleware) flushToPostgres() {
	ctx := context.Background()

	a.flushMetricsBuckets(ctx)
	a.flushUsageBuckets(ctx)

	today     := time.Now().UTC().Format("2006-01-02")
	yesterday := time.Now().UTC().AddDate(0, 0, -1).Format("2006-01-02")

	// Limit SCAN to the two relevant date prefixes so we never scan the full
	// keyspace (which could be very large in production).
	patterns := []string{
		fmt.Sprintf("stats:*:%s", today),
		fmt.Sprintf("stats:*:%s", yesterday),
	}

	for _, pattern := range patterns {
		var cursor uint64
		for {
			keys, nextCursor, err := a.redis.Scan(ctx, cursor, pattern, 100).Result()
			if err != nil {
				break
			}
			for _, key := range keys {
				a.flushKey(ctx, key)
			}
			cursor = nextCursor
			if cursor == 0 {
				break
			}
		}
	}
}

// flushKey reads all counters for a single stats key, upserts them into
// PostgreSQL, then resets the Redis counters to zero to prevent double-counting
// on the next flush cycle.
func (a *AnalyticsMiddleware) flushKey(ctx context.Context, key string) {
	// Key format: stats:{site_id}:{YYYY-MM-DD}
	parts := strings.SplitN(key, ":", 3)
	if len(parts) != 3 {
		return
	}
	siteID := parts[1]
	date   := parts[2]

	// Read all counter fields in a single round-trip
	vals, err := a.redis.HGetAll(ctx, key).Result()
	if err != nil || len(vals) == 0 {
		return
	}

	parse := func(field string) int64 {
		v, _ := strconv.ParseInt(vals[field], 10, 64)
		return v
	}

	requests  := parse("requests")
	bandwidth := parse("bandwidth")
	req2xx    := parse("requests_2xx")
	req3xx    := parse("requests_3xx")
	req4xx    := parse("requests_4xx")
	req5xx    := parse("requests_5xx")
	humans    := parse("humans")
	bots      := parse("bots")

	// Nothing new since the last flush — skip to avoid no-op DB round-trips.
	if requests == 0 {
		return
	}

	// Unique IP cardinality estimate from HyperLogLog
	uniqKey  := fmt.Sprintf("uniq:%s:%s", siteID, date)
	uniqueIPs, _ := a.redis.PFCount(ctx, uniqKey).Result()

	// Peak hour: find the hour slot with the highest request count for this date.
	peakHour, peakCount := a.getPeakHour(ctx, siteID, date)

	// Upsert into PostgreSQL.
	// On conflict we *add* the delta counters (not replace) so that data
	// accumulated between flush cycles is never lost.
	// unique_ips and peak_hour are replaced because they are point-in-time
	// estimates rather than cumulative sums.
	_, err = a.db.ExecContext(ctx, `
		INSERT INTO site_daily_stats (
			site_id, date,
			requests, bandwidth,
			requests_2xx, requests_3xx, requests_4xx, requests_5xx,
			humans, bots, unique_ips,
			peak_hour, peak_hour_requests,
			updated_at
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, NOW())
		ON CONFLICT (site_id, date) DO UPDATE SET
			requests           = site_daily_stats.requests           + EXCLUDED.requests,
			bandwidth          = site_daily_stats.bandwidth          + EXCLUDED.bandwidth,
			requests_2xx       = site_daily_stats.requests_2xx       + EXCLUDED.requests_2xx,
			requests_3xx       = site_daily_stats.requests_3xx       + EXCLUDED.requests_3xx,
			requests_4xx       = site_daily_stats.requests_4xx       + EXCLUDED.requests_4xx,
			requests_5xx       = site_daily_stats.requests_5xx       + EXCLUDED.requests_5xx,
			humans             = site_daily_stats.humans             + EXCLUDED.humans,
			bots               = site_daily_stats.bots               + EXCLUDED.bots,
			unique_ips         = EXCLUDED.unique_ips,
			peak_hour          = EXCLUDED.peak_hour,
			peak_hour_requests = EXCLUDED.peak_hour_requests,
			updated_at         = NOW()
	`,
		siteID, date,
		requests, bandwidth,
		req2xx, req3xx, req4xx, req5xx,
		humans, bots, uniqueIPs,
		peakHour, peakCount,
	)
	if err != nil {
		// Non-fatal: we'll retry on the next flush cycle.
		return
	}

	// Reset counters in Redis after a successful flush so the next cycle only
	// sees new traffic.  We intentionally do NOT reset the HyperLogLog (uniqKey)
	// — its TTL handles expiry and resetting it would lose cardinality state.
	_ = a.redis.HSet(ctx, key,
		"requests",     0,
		"bandwidth",    0,
		"requests_2xx", 0,
		"requests_3xx", 0,
		"requests_4xx", 0,
		"requests_5xx", 0,
		"humans",       0,
		"bots",         0,
	).Err()
}

// getPeakHour scans all 24 hourly peak keys for the given site+date and returns
// the hour string ("14:00") and its request count.
func (a *AnalyticsMiddleware) getPeakHour(ctx context.Context, siteID, date string) (string, int64) {
	var peakHour  string
	var peakCount int64

	for h := 0; h < 24; h++ {
		hourStr := fmt.Sprintf("%s:%02d", date, h)
		peakKey := fmt.Sprintf("peak:%s:%s", siteID, hourStr)

		val, err := a.redis.Get(ctx, peakKey).Int64()
		if err != nil {
			continue
		}
		if val > peakCount {
			peakCount = val
			peakHour  = fmt.Sprintf("%02d:00", h)
		}
	}

	return peakHour, peakCount
}

// ─── Operational metrics flush (→ service_metrics_hourly) ─────────────────────

// parseHashField reads an integer hash field, defaulting to 0 when absent or
// unparseable.
func parseHashField(vals map[string]string, field string) int64 {
	raw, ok := vals[field]
	if !ok {
		return 0
	}
	n, err := strconv.ParseInt(raw, 10, 64)
	if err != nil {
		return 0
	}
	return n
}

// flushMetricsBuckets drains metrics:{site_id}:{minute} hashes into the hourly
// service_metrics_hourly table. Each key is claimed (read + delete) before the
// write so a slow flusher cannot double-count. Losing a bucket on a DB failure
// is acceptable for operational metrics.
func (a *AnalyticsMiddleware) flushMetricsBuckets(ctx context.Context) {
	if a.redis == nil || a.db == nil {
		return
	}
	var cursor uint64
	for {
		keys, next, err := a.redis.Scan(ctx, cursor, MetricsKeyPrefix+":*", 200).Result()
		if err != nil {
			return
		}
		for _, key := range keys {
			a.flushMetricsKey(ctx, key)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

func (a *AnalyticsMiddleware) flushMetricsKey(ctx context.Context, key string) {
	siteID, bucket, ok := parseMetricsBucketKey(key)
	if !ok {
		return
	}
	vals, err := a.redis.HGetAll(ctx, key).Result()
	if err != nil || len(vals) == 0 {
		return
	}
	// Claim the bucket. In-flight increments for the current minute land in
	// the next bucket.
	_ = a.redis.Del(ctx, key).Err()

	hourBucket := bucket.Truncate(time.Hour)
	_, _ = a.db.ExecContext(ctx, `
		INSERT INTO service_metrics_hourly (
			site_id, bucket,
			requests, status_2xx, status_3xx, status_4xx, status_5xx,
			bytes, cache_hits, cache_misses,
			latency_sum_ms,
			latency_le_50, latency_le_100, latency_le_250,
			latency_le_500, latency_le_1000, latency_le_2500,
			updated_at
		) VALUES (
			$1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
			$12, $13, $14, $15, $16, $17, NOW()
		)
		ON CONFLICT (site_id, bucket) DO UPDATE SET
			requests         = service_metrics_hourly.requests         + EXCLUDED.requests,
			status_2xx       = service_metrics_hourly.status_2xx       + EXCLUDED.status_2xx,
			status_3xx       = service_metrics_hourly.status_3xx       + EXCLUDED.status_3xx,
			status_4xx       = service_metrics_hourly.status_4xx       + EXCLUDED.status_4xx,
			status_5xx       = service_metrics_hourly.status_5xx       + EXCLUDED.status_5xx,
			bytes            = service_metrics_hourly.bytes            + EXCLUDED.bytes,
			cache_hits       = service_metrics_hourly.cache_hits       + EXCLUDED.cache_hits,
			cache_misses     = service_metrics_hourly.cache_misses     + EXCLUDED.cache_misses,
			latency_sum_ms   = service_metrics_hourly.latency_sum_ms   + EXCLUDED.latency_sum_ms,
			latency_le_50    = service_metrics_hourly.latency_le_50    + EXCLUDED.latency_le_50,
			latency_le_100   = service_metrics_hourly.latency_le_100   + EXCLUDED.latency_le_100,
			latency_le_250   = service_metrics_hourly.latency_le_250   + EXCLUDED.latency_le_250,
			latency_le_500   = service_metrics_hourly.latency_le_500   + EXCLUDED.latency_le_500,
			latency_le_1000  = service_metrics_hourly.latency_le_1000  + EXCLUDED.latency_le_1000,
			latency_le_2500  = service_metrics_hourly.latency_le_2500  + EXCLUDED.latency_le_2500,
			updated_at       = NOW()
	`,
		siteID, hourBucket,
		parseHashField(vals, "requests"),
		parseHashField(vals, "status_2xx"),
		parseHashField(vals, "status_3xx"),
		parseHashField(vals, "status_4xx"),
		parseHashField(vals, "status_5xx"),
		parseHashField(vals, "bytes"),
		parseHashField(vals, "cache_hits"),
		parseHashField(vals, "cache_misses"),
		parseHashField(vals, "latency_sum_ms"),
		parseHashField(vals, "latency_le_50"),
		parseHashField(vals, "latency_le_100"),
		parseHashField(vals, "latency_le_250"),
		parseHashField(vals, "latency_le_500"),
		parseHashField(vals, "latency_le_1000"),
		parseHashField(vals, "latency_le_2500"),
	)
}

// ─── Bandwidth usage flush (→ bandwidth_usage_hourly) ─────────────────────────

// flushUsageBuckets drains usage:bw:{site_id}:{hour} counters into the
// bandwidth_usage_hourly table. tenant_id is resolved from the pages row at
// flush time so the hot serving path never touches PostgreSQL.
func (a *AnalyticsMiddleware) flushUsageBuckets(ctx context.Context) {
	if a.redis == nil || a.db == nil {
		return
	}
	var cursor uint64
	for {
		keys, next, err := a.redis.Scan(ctx, cursor, UsageKeyPrefix+":*", 200).Result()
		if err != nil {
			return
		}
		for _, key := range keys {
			a.flushUsageKey(ctx, key)
		}
		cursor = next
		if cursor == 0 {
			break
		}
	}
}

func (a *AnalyticsMiddleware) flushUsageKey(ctx context.Context, key string) {
	siteID, bucket, ok := parseUsageBucketKey(key)
	if !ok {
		return
	}
	// Atomically claim and reset the counter so a concurrent request cannot be
	// lost in the read/write gap.
	val, err := a.redis.GetDel(ctx, key).Int64()
	if err != nil || val <= 0 {
		return
	}

	res, err := a.db.ExecContext(ctx, `
		INSERT INTO bandwidth_usage_hourly (tenant_id, site_id, bucket, bytes)
		SELECT p.tenant_id, $1::uuid, $2::timestamptz, $3
		FROM pages p
		WHERE p.site_id = $1::uuid
		ON CONFLICT (tenant_id, site_id, bucket) DO UPDATE
		SET bytes = bandwidth_usage_hourly.bytes + EXCLUDED.bytes
	`, siteID, bucket, val)
	if err != nil {
		a.restoreUsage(ctx, key, val)
		return
	}
	if rows, rerr := res.RowsAffected(); rerr == nil && rows == 0 {
		// No page row for this site — restore rather than silently drop
		// billable bytes.
		a.restoreUsage(ctx, key, val)
	}
}

// restoreUsage puts claimed bandwidth back into Redis when persistence fails,
// so transient outages do not lose billable usage. Safe because the DB write
// did not commit.
func (a *AnalyticsMiddleware) restoreUsage(ctx context.Context, key string, val int64) {
	_ = a.redis.IncrBy(ctx, key, val).Err()
	_ = a.redis.Expire(ctx, key, usageBucketTTL).Err()
}
