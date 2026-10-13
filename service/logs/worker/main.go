package main

import (
	"compress/gzip"
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/aws-sdk-go-v2/service/s3/types"
	"github.com/aws/smithy-go"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type config struct {
	databaseURL string
	r2AccountID string
	r2AccessKey string
	r2SecretKey string
	r2Bucket    string
	r2Prefix    string
	hostSuffix  string
	cfAccountID string
	cfQueueID   string
	cfToken     string
	drainBatch  int
	drainMax    int
	maxFiles    int
	scanDays    int
}

func envOr(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}

func envInt(key string, def int) int {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return def
}

func loadConfig() (config, error) {
	cfg := config{
		databaseURL: envOr("DATABASE_URL", ""),
		r2AccountID: envOr("R2_ACCOUNT_ID", ""),
		r2AccessKey: envOr("R2_ACCESS_KEY_ID", ""),
		r2SecretKey: envOr("R2_SECRET_ACCESS_KEY", ""),
		r2Bucket:    envOr("R2_LOGS_BUCKET", "logs-raw"),
		r2Prefix:    envOr("R2_PREFIX", "raw/"),
		hostSuffix:  envOr("LOGS_HOST_SUFFIX", defaultHostSuffix),
		cfAccountID: envOr("CF_ACCOUNT_ID", ""),
		cfQueueID:   envOr("CF_QUEUE_ID", ""),
		cfToken:     envOr("CF_QUEUE_API_TOKEN", ""),
		drainBatch:  envInt("LOGS_DRAIN_BATCH", 100),
		drainMax:    envInt("LOGS_DRAIN_MAX", 10),
		maxFiles:    envInt("LOGS_MAX_FILES", 200),
		scanDays:    envInt("LOGS_SCAN_DAYS", 2),
	}

	var missing []string
	for _, req := range []struct {
		name string
		val  string
	}{
		{"DATABASE_URL", cfg.databaseURL},
		{"R2_ACCOUNT_ID", cfg.r2AccountID},
		{"R2_ACCESS_KEY_ID", cfg.r2AccessKey},
		{"R2_SECRET_ACCESS_KEY", cfg.r2SecretKey},
		{"CF_ACCOUNT_ID", cfg.cfAccountID},
		{"CF_QUEUE_ID", cfg.cfQueueID},
		{"CF_QUEUE_API_TOKEN", cfg.cfToken},
	} {
		if strings.TrimSpace(req.val) == "" {
			missing = append(missing, req.name)
		}
	}
	if len(missing) > 0 {
		return config{}, fmt.Errorf("missing required env: %s", strings.Join(missing, ", "))
	}
	return cfg, nil
}

func main() {
	filePath := flag.String("file", "", "aggregate a local NDJSON file and print a summary (no R2/queue/DB)")
	flag.Parse()

	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo})))

	if *filePath != "" {
		if err := runLocalFile(*filePath); err != nil {
			slog.Error("local file run failed", "err", err)
			os.Exit(1)
		}
		return
	}

	cfg, err := loadConfig()
	if err != nil {
		slog.Error("configuration error", "err", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
	defer cancel()

	if err := run(ctx, cfg); err != nil {
		slog.Error("run failed", "err", err)
		os.Exit(1)
	}
}

func run(ctx context.Context, cfg config) error {
	pool, err := newPool(ctx, cfg.databaseURL)
	if err != nil {
		return err
	}
	defer pool.Close()

	if err := ensureSchema(ctx, pool); err != nil {
		return fmt.Errorf("ensure schema: %w", err)
	}

	r2 := newR2Client(cfg)
	queue := newQueueClient(cfg.cfAccountID, cfg.cfQueueID, cfg.cfToken)

	drained, err := drainQueue(ctx, queue, pool, cfg)
	if err != nil {
		return fmt.Errorf("drain queue: %w", err)
	}
	slog.Info("queue drained", "keys", drained)

	// Logpush writes to R2 server-side, bypassing the S3-compatible endpoint
	// that R2 event notifications hook into, so queue messages may never
	// arrive. Scan recent raw/YYYYMMDD/ prefixes as the reliable ingest path;
	// processed_files + pending_files dedupe against re-processing.
	scanned, added, err := scanRecent(ctx, r2, pool, cfg, time.Now().UTC())
	if err != nil {
		return fmt.Errorf("scan r2 recent: %w", err)
	}
	slog.Info("r2 scan staged", "keys_scanned", scanned, "added", added)

	pending, err := claimPending(ctx, pool, cfg.maxFiles)
	if err != nil {
		return fmt.Errorf("claim pending: %w", err)
	}
	slog.Info("pending claimed", "count", len(pending))

	res, err := processFiles(ctx, r2, pool, cfg, pending)
	if err != nil {
		return fmt.Errorf("process files: %w", err)
	}
	slog.Info("run complete",
		"files", res.files,
		"records", res.records,
		"skipped", res.skipped,
		"usage_rows", res.usageRows,
		"country_rows", res.countryRows,
	)
	return nil
}

func runLocalFile(path string) error {
	f, err := os.Open(path)
	if err != nil {
		return err
	}
	defer f.Close()

	agg := newAggregation()
	if err := parseRecords(f, defaultHostSuffix, agg); err != nil {
		return err
	}

	fmt.Printf("records=%d skipped=%d usage_rows=%d country_rows=%d\n",
		agg.records, agg.skipped, len(agg.usage), len(agg.country))
	for k, v := range agg.usage {
		fmt.Printf("%s %s requests=%d bytes=%d 2xx=%d 3xx=%d 4xx=%d 5xx=%d cache_hits=%d\n",
			k.host, k.hour.Format(time.RFC3339),
			v.requests, v.bytes, v.s2xx, v.s3xx, v.s4xx, v.s5xx, v.cacheHits)
	}
	return nil
}

func newR2Client(cfg config) *s3.Client {
	endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.r2AccountID)
	return s3.New(s3.Options{
		Region:       "auto",
		Credentials:  credentials.NewStaticCredentialsProvider(cfg.r2AccessKey, cfg.r2SecretKey, ""),
		BaseEndpoint: aws.String(endpoint),
		UsePathStyle: true,
	})
}

func sanitizeDSN(dsn string) string {
	if !strings.Contains(dsn, "channel_binding") {
		return dsn
	}
	base, rawQuery, ok := strings.Cut(dsn, "?")
	if !ok {
		return dsn
	}
	q := url.Values{}
	for _, kv := range strings.Split(rawQuery, "&") {
		if kv == "" || strings.HasPrefix(kv, "channel_binding=") {
			continue
		}
		k, v, _ := strings.Cut(kv, "=")
		q.Set(k, v)
	}
	if len(q) == 0 {
		return base
	}
	return base + "?" + q.Encode()
}

func newPool(ctx context.Context, dsn string) (*pgxpool.Pool, error) {
	pc, err := pgxpool.ParseConfig(sanitizeDSN(dsn))
	if err != nil {
		return nil, fmt.Errorf("parse DATABASE_URL: %w", err)
	}
	pc.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeSimpleProtocol

	pool, err := pgxpool.NewWithConfig(ctx, pc)
	if err != nil {
		return nil, err
	}
	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := pool.Ping(pingCtx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("ping database: %w", err)
	}
	return pool, nil
}

// ensureSchema mirrors db/migrations/001_init.sql so the worker is
// self-sufficient on first run. Keep the two in sync.
func ensureSchema(ctx context.Context, pool *pgxpool.Pool) error {
	if _, err := pool.Exec(ctx, schemaDDL); err != nil {
		return err
	}
	return nil
}

const schemaDDL = `
CREATE TABLE IF NOT EXISTS processed_files (
    key          text PRIMARY KEY,
    processed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pending_files (
    key        text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS usage_hourly (
    host       text        NOT NULL,
    hour       timestamptz NOT NULL,
    requests   bigint      NOT NULL DEFAULT 0,
    bytes      bigint      NOT NULL DEFAULT 0,
    s2xx       bigint      NOT NULL DEFAULT 0,
    s3xx       bigint      NOT NULL DEFAULT 0,
    s4xx       bigint      NOT NULL DEFAULT 0,
    s5xx       bigint      NOT NULL DEFAULT 0,
    cache_hits bigint      NOT NULL DEFAULT 0,
    PRIMARY KEY (host, hour)
);
CREATE TABLE IF NOT EXISTS country_hourly (
    host     text        NOT NULL,
    hour     timestamptz NOT NULL,
    country  text        NOT NULL,
    requests bigint      NOT NULL DEFAULT 0,
    PRIMARY KEY (host, hour, country)
);
CREATE INDEX IF NOT EXISTS usage_hourly_hour_idx ON usage_hourly (hour);
CREATE INDEX IF NOT EXISTS country_hourly_hour_idx ON country_hourly (hour);
`

func drainQueue(ctx context.Context, queue *queueClient, pool *pgxpool.Pool, cfg config) (int, error) {
	var total int
	for i := 0; i < cfg.drainMax; i++ {
		messages, err := queue.pull(ctx, cfg.drainBatch, 60_000)
		if err != nil {
			return total, err
		}
		if len(messages) == 0 {
			break
		}

		keys := make([]string, 0, len(messages))
		acks := make([]string, 0, len(messages))
		for _, m := range messages {
			acks = append(acks, m.LeaseID)
			key, err := extractObjectKey(m.Body)
			if err != nil {
				slog.Warn("dropping unparseable queue message", "id", m.ID, "attempts", m.Attempts, "err", err)
				continue
			}
			keys = append(keys, key)
		}

		if len(keys) > 0 {
			if err := insertPending(ctx, pool, keys); err != nil {
				return total, err
			}
		}
		if err := queue.ack(ctx, acks, nil); err != nil {
			return total, err
		}
		total += len(keys)

		if len(messages) < cfg.drainBatch {
			break
		}
	}
	return total, nil
}

func insertPending(ctx context.Context, pool *pgxpool.Pool, keys []string) error {
	batch := &pgx.Batch{}
	for _, k := range keys {
		batch.Queue(`INSERT INTO pending_files (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, k)
	}
	results := pool.SendBatch(ctx, batch)
	defer results.Close()
	for range keys {
		if _, err := results.Exec(); err != nil {
			return err
		}
	}
	return nil
}

// recentDayPrefixes returns the raw/YYYYMMDD/ prefixes for the last `days`
// days including today, oldest first.
func recentDayPrefixes(now time.Time, days int, prefix string) []string {
	var out []string
	for i := days; i >= 0; i-- {
		out = append(out, prefix+now.AddDate(0, 0, -i).Format("20060102")+"/")
	}
	return out
}

// listKeys lists .gz object keys under a prefix (bounded to 10k keys).
func listKeys(ctx context.Context, r2 *s3.Client, bucket, prefix string) ([]string, error) {
	var keys []string
	p := s3.NewListObjectsV2Paginator(r2, &s3.ListObjectsV2Input{
		Bucket: aws.String(bucket),
		Prefix: aws.String(prefix),
	})
	for p.HasMorePages() && len(keys) < 10_000 {
		page, err := p.NextPage(ctx)
		if err != nil {
			return nil, fmt.Errorf("list r2 %s: %w", prefix, err)
		}
		for _, o := range page.Contents {
			if o.Key != nil && strings.HasSuffix(*o.Key, ".gz") {
				keys = append(keys, *o.Key)
			}
		}
		if len(page.Contents) == 0 {
			break
		}
	}
	return keys, nil
}

// stageScannedReady inserts keys into pending_files only if they are not
// already in processed_files; returns how many were added.
func stageScannedReady(ctx context.Context, pool *pgxpool.Pool, keys []string) (int, error) {
	var added int
	if len(keys) == 0 {
		return 0, nil
	}
	batch := &pgx.Batch{}
	for _, k := range keys {
		batch.Queue(`INSERT INTO pending_files (key)
			SELECT $1
			WHERE NOT EXISTS (SELECT 1 FROM processed_files WHERE key = $1)
			ON CONFLICT (key) DO NOTHING`, k)
	}
	results := pool.SendBatch(ctx, batch)
	defer results.Close()
	for range keys {
		tag, err := results.Exec()
		if err != nil {
			return added, err
		}
		added += int(tag.RowsAffected())
	}
	return added, nil
}

// scanRecent lists recent R2 prefixes and stages any unprocessed keys.
func scanRecent(ctx context.Context, r2 *s3.Client, pool *pgxpool.Pool, cfg config, now time.Time) (scanned, added int, err error) {
	for _, prefix := range recentDayPrefixes(now, cfg.scanDays, cfg.r2Prefix) {
		keys, err := listKeys(ctx, r2, cfg.r2Bucket, prefix)
		if err != nil {
			return scanned, added, err
		}
		scanned += len(keys)
		n, err := stageScannedReady(ctx, pool, keys)
		if err != nil {
			return scanned, added, err
		}
		added += n
	}
	return scanned, added, nil
}

func claimPending(ctx context.Context, pool *pgxpool.Pool, limit int) ([]string, error) {
	rows, err := pool.Query(ctx, `SELECT key FROM pending_files ORDER BY created_at, key LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var keys []string
	for rows.Next() {
		var key string
		if err := rows.Scan(&key); err != nil {
			return nil, err
		}
		keys = append(keys, key)
	}
	return keys, rows.Err()
}

func deletePending(ctx context.Context, pool *pgxpool.Pool, key string) error {
	_, err := pool.Exec(ctx, `DELETE FROM pending_files WHERE key = $1`, key)
	return err
}

func isProcessed(ctx context.Context, pool *pgxpool.Pool, key string) (bool, error) {
	var exists bool
	err := pool.QueryRow(ctx, `SELECT EXISTS(SELECT 1 FROM processed_files WHERE key = $1)`, key).Scan(&exists)
	return exists, err
}

type runResult struct {
	files       int
	records     int64
	skipped     int64
	usageRows   int
	countryRows int
}

var errObjectNotFound = errors.New("object not found")

func processFiles(ctx context.Context, r2 *s3.Client, pool *pgxpool.Pool, cfg config, keys []string) (runResult, error) {
	var res runResult
	for _, key := range keys {
		if !isRawKey(cfg.r2Prefix, key) {
			if err := deletePending(ctx, pool, key); err != nil {
				return res, err
			}
			continue
		}

		processed, err := isProcessed(ctx, pool, key)
		if err != nil {
			return res, err
		}
		if processed {
			if err := deletePending(ctx, pool, key); err != nil {
				return res, err
			}
			continue
		}

		agg, err := downloadAndAggregate(ctx, r2, cfg, key)
		if err != nil {
			if errors.Is(err, errObjectNotFound) {
				slog.Warn("object not found yet; leaving pending", "key", key)
				continue
			}
			return res, fmt.Errorf("download %s: %w", key, err)
		}

		if agg.records == 0 && len(agg.usage) == 0 && len(agg.country) == 0 {
			// Empty parse is almost always a Logpush upload still in flight
			// (empty/partial object before CompleteMultipartUpload settles).
			// Leave it pending so a later run re-downloads the settled file.
			slog.Warn("no records parsed; leaving pending for retry", "key", key)
			continue
		}

		if err := storeFile(ctx, pool, key, agg); err != nil {
			return res, fmt.Errorf("store %s: %w", key, err)
		}
		res.files++
		res.records += agg.records
		res.skipped += agg.skipped
		res.usageRows += len(agg.usage)
		res.countryRows += len(agg.country)
	}
	return res, nil
}

func downloadAndAggregate(ctx context.Context, r2 *s3.Client, cfg config, key string) (*aggregation, error) {
	out, err := r2.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(cfg.r2Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		if isNotFound(err) {
			return nil, errObjectNotFound
		}
		return nil, err
	}
	defer out.Body.Close()

	body := out.Body
	if strings.HasSuffix(key, ".gz") {
		gzr, err := gzip.NewReader(out.Body)
		if err != nil {
			return nil, fmt.Errorf("gzip open %s: %w", key, err)
		}
		defer gzr.Close()
		body = gzr
	}

	agg := newAggregation()
	if err := parseRecords(body, cfg.hostSuffix, agg); err != nil {
		return nil, err
	}
	return agg, nil
}

func isNotFound(err error) bool {
	var noSuchKey *types.NoSuchKey
	if errors.As(err, &noSuchKey) {
		return true
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) && apiErr.ErrorCode() == "NoSuchKey" {
		return true
	}
	return false
}

func storeFile(ctx context.Context, pool *pgxpool.Pool, key string, agg *aggregation) error {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	if err := upsertAggregation(ctx, tx, agg); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `INSERT INTO processed_files (key) VALUES ($1) ON CONFLICT (key) DO NOTHING`, key); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `DELETE FROM pending_files WHERE key = $1`, key); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

const upsertUsageSQL = `
INSERT INTO usage_hourly (host, hour, requests, bytes, s2xx, s3xx, s4xx, s5xx, cache_hits)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
ON CONFLICT (host, hour) DO UPDATE SET
    requests   = usage_hourly.requests   + EXCLUDED.requests,
    bytes      = usage_hourly.bytes      + EXCLUDED.bytes,
    s2xx       = usage_hourly.s2xx       + EXCLUDED.s2xx,
    s3xx       = usage_hourly.s3xx       + EXCLUDED.s3xx,
    s4xx       = usage_hourly.s4xx       + EXCLUDED.s4xx,
    s5xx       = usage_hourly.s5xx       + EXCLUDED.s5xx,
    cache_hits = usage_hourly.cache_hits + EXCLUDED.cache_hits`

const upsertCountrySQL = `
INSERT INTO country_hourly (host, hour, country, requests)
VALUES ($1, $2, $3, $4)
ON CONFLICT (host, hour, country) DO UPDATE SET
    requests = country_hourly.requests + EXCLUDED.requests`

func upsertAggregation(ctx context.Context, tx pgx.Tx, agg *aggregation) error {
	for k, v := range agg.usage {
		if _, err := tx.Exec(ctx, upsertUsageSQL,
			k.host, k.hour, v.requests, v.bytes, v.s2xx, v.s3xx, v.s4xx, v.s5xx, v.cacheHits,
		); err != nil {
			return fmt.Errorf("upsert usage %s %s: %w", k.host, k.hour.Format(time.RFC3339), err)
		}
	}
	for k, v := range agg.country {
		if _, err := tx.Exec(ctx, upsertCountrySQL,
			k.host, k.hour, k.country, v,
		); err != nil {
			return fmt.Errorf("upsert country %s %s %s: %w", k.host, k.hour.Format(time.RFC3339), k.country, err)
		}
	}
	return nil
}
