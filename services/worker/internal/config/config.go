// Package config loads the worker's settings from the environment.
//
// The names deliberately reuse the console's and blob-server's existing
// PostgreSQL / MinIO variables (DATABASE_URL, MINIO_*, S3_*), so the worker
// talks to exactly the same Neon database and the same object store without any
// parallel naming scheme.
package config

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Config is the fully-resolved worker configuration.
type Config struct {
	// Cloudflare Queues (HTTP pull consumer — no Worker binding).
	AccountID    string
	QueueID      string
	QueueToken   string
	DLQID        string // optional; explicit dead-letter target
	QueueName    string // used by `provision` to create the queue
	DLQName      string
	QueueMaxRetr int           // consumer-level retry budget before Cloudflare's DLQ
	QueueRetain  time.Duration // how long an unconsumed message is kept

	// Consumer loop.
	Concurrency        int
	BatchSize          int
	VisibilityTimeout  time.Duration
	PollInterval       time.Duration
	MaxLocalAttempts   int
	RequestTimeout     time.Duration
	DatabaseMaxConns   int
	StorageDeleteBatch int

	// PostgreSQL (Neon).
	DatabaseURL string

	// MinIO / S3.
	Endpoint     string
	Region       string
	Bucket       string
	AccessKey    string
	SecretKey    string
	UsePathStyle bool

	// Redis (Upstash REST) — optional. Only used to drop cached routing state
	// for a deleted project; PostgreSQL stays authoritative.
	RedisURL     string
	RedisToken   string
	RedisPrefix  string
	RedisEnabled bool

	// Deployment retention: how many recent deployments to keep per page.
	DeploymentRetention int
}

// Defaults mirror the Cloudflare Queues HTTP pull consumer limits: batch_size
// defaults to 5 with a 100 maximum, visibility_timeout defaults to 30s and may
// range up to 12h.
const (
	DefaultQueueName      = "pagex-background"
	DefaultDLQName        = "pagex-background-dlq"
	DefaultConcurrency    = 10
	DefaultBatchSize      = 10
	DefaultMaxLocalTries  = 3
	DefaultVisibilityTO   = 30 * time.Second
	DefaultPollInterval   = 2 * time.Second
	DefaultRequestTO      = 30 * time.Second
	DefaultDBMaxConns     = 10
	DefaultDeleteBatch    = 100
	DefaultRetention      = 10
	DefaultQueueMaxRetry  = 3
	DefaultQueueRetention = 4 * 24 * time.Hour
)

// Load reads the environment and validates everything the consumer needs,
// including the queue ID. Missing variables are reported together so a
// misconfigured deploy fails fast at startup instead of silently dropping jobs.
func Load() (*Config, error) {
	return load(true)
}

// LoadForProvision reads the environment for `worker provision`, which runs
// *before* the queue exists and therefore must not require CF_QUEUE_ID or any of
// the storage credentials — provisioning only talks to the Cloudflare API.
func LoadForProvision() (*Config, error) {
	return load(false)
}

func load(requireRuntime bool) (*Config, error) {
	c := &Config{
		AccountID:    strings.TrimSpace(os.Getenv("CF_ACCOUNT_ID")),
		QueueID:      strings.TrimSpace(os.Getenv("CF_QUEUE_ID")),
		QueueToken:   strings.TrimSpace(os.Getenv("CF_QUEUE_API_TOKEN")),
		DLQID:        strings.TrimSpace(os.Getenv("CF_QUEUE_DLQ_ID")),
		QueueName:    envOr("CF_QUEUE_NAME", DefaultQueueName),
		DLQName:      envOr("CF_QUEUE_DLQ_NAME", DefaultDLQName),
		QueueMaxRetr: intOr("CF_QUEUE_MAX_RETRIES", DefaultQueueMaxRetry),
		QueueRetain:  durationOr("CF_QUEUE_RETENTION", DefaultQueueRetention),

		Concurrency:        intOr("WORKER_CONCURRENCY", DefaultConcurrency),
		BatchSize:          intOr("WORKER_BATCH_SIZE", DefaultBatchSize),
		VisibilityTimeout:  durationOr("WORKER_VISIBILITY_TIMEOUT", DefaultVisibilityTO),
		PollInterval:       durationOr("WORKER_POLL_INTERVAL", DefaultPollInterval),
		MaxLocalAttempts:   intOr("WORKER_MAX_ATTEMPTS", DefaultMaxLocalTries),
		RequestTimeout:     durationOr("WORKER_REQUEST_TIMEOUT", DefaultRequestTO),
		DatabaseMaxConns:   intOr("WORKER_DATABASE_MAX_CONNS", DefaultDBMaxConns),
		StorageDeleteBatch: intOr("WORKER_DELETE_BATCH_SIZE", DefaultDeleteBatch),

		DatabaseURL: strings.TrimSpace(os.Getenv("DATABASE_URL")),

		Region:       envOr("S3_REGION", envOr("MINIO_REGION", "us-east-1")),
		Bucket:       strings.TrimSpace(os.Getenv("MINIO_BUCKET")),
		AccessKey:    strings.TrimSpace(os.Getenv("S3_ACCESS_KEY")),
		SecretKey:    strings.TrimSpace(os.Getenv("S3_SECRET_KEY")),
		UsePathStyle: boolOr("MINIO_USE_PATH_STYLE", true),

		RedisURL:     strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_URL")),
		RedisToken:   strings.TrimSpace(os.Getenv("UPSTASH_REDIS_REST_TOKEN")),
		RedisPrefix:  envOr("REDIS_KEY_PREFIX", "px"),
		RedisEnabled: boolOr("WORKER_REDIS_CLEANUP", true),

		DeploymentRetention: intOr("DEPLOYMENT_RETENTION", DefaultRetention),
	}

	endpoint, err := resolveEndpoint()
	if err != nil {
		return nil, err
	}
	c.Endpoint = endpoint
	if c.RedisURL != "" {
		c.RedisEnabled = c.RedisEnabled && c.RedisToken != ""
	}

	if err := c.validate(requireRuntime); err != nil {
		return nil, err
	}
	return c, nil
}

// resolveEndpoint builds the S3 base endpoint from either a full URL
// (MINIO_ENDPOINT_URL, what the blob-server and the .env example use) or the
// host/port/SSL trio the console's MinIO client uses.
func resolveEndpoint() (string, error) {
	if raw := strings.TrimSpace(os.Getenv("MINIO_ENDPOINT_URL")); raw != "" {
		if _, err := url.Parse(raw); err != nil {
			return "", fmt.Errorf("MINIO_ENDPOINT_URL is not a valid URL: %w", err)
		}
		return strings.TrimSuffix(raw, "/"), nil
	}

	host := strings.TrimSpace(os.Getenv("MINIO_ENDPOINT"))
	if host == "" {
		return "", nil
	}

	scheme := "https"
	switch strings.ToLower(os.Getenv("MINIO_USE_SSL")) {
	case "true":
		scheme = "https"
	case "false":
		scheme = "http"
	default:
		// Match the console's MinIO client: plain HTTP only for local hosts.
		if host == "minio" || host == "localhost" {
			scheme = "http"
		}
	}

	endpoint := host
	if !strings.Contains(host, ":") {
		if port := strings.TrimSpace(os.Getenv("MINIO_PORT")); port != "" {
			endpoint = net.JoinHostPort(host, port)
		} else if scheme == "https" {
			endpoint = net.JoinHostPort(host, "443")
		} else {
			endpoint = net.JoinHostPort(host, "80")
		}
	}

	return scheme + "://" + endpoint, nil
}

// validate checks the configuration. requireRuntime=false is the provisioning
// path, which only needs the Cloudflare credentials — the queue ID and every
// storage variable do not exist yet on a first run.
func (c *Config) validate(requireRuntime bool) error {
	var missing []string
	if c.AccountID == "" {
		missing = append(missing, "CF_ACCOUNT_ID")
	}
	if c.QueueToken == "" {
		missing = append(missing, "CF_QUEUE_API_TOKEN")
	}
	if requireRuntime {
		if c.QueueID == "" {
			missing = append(missing, "CF_QUEUE_ID")
		}
		if c.DatabaseURL == "" {
			missing = append(missing, "DATABASE_URL")
		}
		if c.Endpoint == "" {
			missing = append(missing, "MINIO_ENDPOINT_URL (or MINIO_ENDPOINT)")
		}
		if c.Bucket == "" {
			missing = append(missing, "MINIO_BUCKET")
		}
		if c.AccessKey == "" {
			missing = append(missing, "S3_ACCESS_KEY")
		}
		if c.SecretKey == "" {
			missing = append(missing, "S3_SECRET_KEY")
		}
	}
	if len(missing) > 0 {
		return fmt.Errorf("missing required environment variables: %s", strings.Join(missing, ", "))
	}
	if c.QueueName == "" {
		return fmt.Errorf("CF_QUEUE_NAME must not be empty")
	}
	if c.DLQName == "" {
		return fmt.Errorf("CF_QUEUE_DLQ_NAME must not be empty")
	}
	if c.QueueName == c.DLQName {
		return fmt.Errorf("CF_QUEUE_NAME and CF_QUEUE_DLQ_NAME must differ (both are %q)", c.QueueName)
	}
	if c.QueueMaxRetr < 0 {
		return fmt.Errorf("CF_QUEUE_MAX_RETRIES must be >= 0, got %d", c.QueueMaxRetr)
	}

	if c.Concurrency < 1 {
		return fmt.Errorf("WORKER_CONCURRENCY must be >= 1, got %d", c.Concurrency)
	}
	// Cloudflare rejects batch_size > 100.
	if c.BatchSize < 1 || c.BatchSize > 100 {
		return fmt.Errorf("WORKER_BATCH_SIZE must be between 1 and 100, got %d", c.BatchSize)
	}
	if c.VisibilityTimeout < time.Second {
		return fmt.Errorf("WORKER_VISIBILITY_TIMEOUT must be >= 1s, got %s", c.VisibilityTimeout)
	}
	// 12h is the Cloudflare maximum for a pull-consumer visibility timeout.
	if c.VisibilityTimeout > 12*time.Hour {
		return fmt.Errorf("WORKER_VISIBILITY_TIMEOUT must be <= 12h, got %s", c.VisibilityTimeout)
	}
	if c.MaxLocalAttempts < 1 {
		return fmt.Errorf("WORKER_MAX_ATTEMPTS must be >= 1, got %d", c.MaxLocalAttempts)
	}
	if c.DeploymentRetention < 1 {
		return fmt.Errorf("DEPLOYMENT_RETENTION must be >= 1, got %d", c.DeploymentRetention)
	}
	if c.StorageDeleteBatch < 1 || c.StorageDeleteBatch > 1000 {
		return fmt.Errorf("WORKER_DELETE_BATCH_SIZE must be between 1 and 1000, got %d", c.StorageDeleteBatch)
	}
	return nil
}

// StorageKeyPrefix mirrors the console's Redis key namespace so cache cleanup
// removes the exact keys the console and blob-server wrote.
func (c *Config) StorageKeyPrefix() string {
	if c.RedisPrefix == "" {
		return ""
	}
	return c.RedisPrefix + ":"
}

func envOr(name, fallback string) string {
	if v := strings.TrimSpace(os.Getenv(name)); v != "" {
		return v
	}
	return fallback
}

func intOr(name string, fallback int) int {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	n, err := strconv.Atoi(raw)
	if err != nil {
		return fallback
	}
	return n
}

func boolOr(name string, fallback bool) bool {
	raw := strings.ToLower(strings.TrimSpace(os.Getenv(name)))
	switch raw {
	case "":
		return fallback
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
}

// durationOr accepts a Go duration ("30s", "2m") or a bare number of seconds.
func durationOr(name string, fallback time.Duration) time.Duration {
	raw := strings.TrimSpace(os.Getenv(name))
	if raw == "" {
		return fallback
	}
	if d, err := time.ParseDuration(raw); err == nil {
		return d
	}
	if secs, err := strconv.Atoi(raw); err == nil {
		return time.Duration(secs) * time.Second
	}
	return fallback
}
