package cdx_s3

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
	"github.com/caddyserver/caddy/v2/caddyconfig/httpcaddyfile"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/dustin/go-humanize"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

func init() {
	caddy.RegisterModule(StaticPlugin{})
	httpcaddyfile.RegisterHandlerDirective("static_s3", parseCaddyfile)
}

type StaticPlugin struct {
	Endpoint     string `json:"endpoint,omitempty"`
	Bucket       string `json:"bucket"`
	AccessKey    string `json:"access_key,omitempty"`
	SecretKey    string `json:"secret_key,omitempty"`
	Region       string `json:"region,omitempty"`
	UsePathStyle *bool  `json:"use_path_style,omitempty"`

	// Prefix is only used in single-tenant mode (prepended to the request path).
	// Multi-tenant mode always serves content-addressed blobs/{hash} keys.
	Prefix         string   `json:"prefix,omitempty"`
	Fallback       string   `json:"fallback,omitempty"`
	FallbackExcept []string `json:"fallback_except,omitempty"`

	CacheTTL     string `json:"cache_ttl,omitempty"`
	CacheSize    int    `json:"cache_size,omitempty"`
	MaxCacheSize string `json:"max_cache_size,omitempty"`

	RedirectToS3       bool   `json:"redirect_to_s3,omitempty"`
	PresignRedirect    bool   `json:"presign_redirect,omitempty"`
	PresignLifetimeStr string `json:"presign_lifetime,omitempty"`

	// Multi-tenant fields
	BaseDomain string `json:"base_domain,omitempty"`
	DBDSN      string `json:"db_dsn,omitempty"`
	RedisURL   string `json:"redis_url,omitempty"`

	// Analytics: set to false to disable per-site statistics collection.
	// Defaults to true when both db_dsn and redis_url are configured.
	AnalyticsEnabled bool `json:"analytics,omitempty"`

	s3Client        *s3.Client
	s3PresignClient *s3.PresignClient
	cache           *LRUCache
	cacheTTL        time.Duration
	maxCacheSize    int64
	presignLifetime time.Duration
	db              *sql.DB
	redisClient     *redis.Client
	analytics       *AnalyticsMiddleware
}

func (StaticPlugin) CaddyModule() caddy.ModuleInfo {
	return caddy.ModuleInfo{
		ID:  "http.handlers.static_s3",
		New: func() caddy.Module { return new(StaticPlugin) },
	}
}

func (p *StaticPlugin) Provision(ctx caddy.Context) error {
	// Fallbacks / Environment Variables
	if p.AccessKey == "" {
		p.AccessKey = os.Getenv("S3_ACCESS_KEY")
	}
	if p.SecretKey == "" {
		p.SecretKey = os.Getenv("S3_SECRET_KEY")
	}
	if p.Region == "" {
		p.Region = os.Getenv("S3_REGION")
		if p.Region == "" {
			p.Region = "us-east-1"
		}
	}
	if p.Bucket == "" {
		p.Bucket = os.Getenv("S3_BUCKET")
		if p.Bucket == "" {
			return fmt.Errorf("static_s3: bucket name must be configured")
		}
	}

	// Multi-tenant: environment variable fallbacks
	if p.BaseDomain == "" {
		p.BaseDomain = os.Getenv("BASE_DOMAIN")
	}
	if p.DBDSN == "" {
		p.DBDSN = os.Getenv("DATABASE_URL")
	}
	if p.RedisURL == "" {
		p.RedisURL = os.Getenv("REDIS_URL")
	}

	// Open PostgreSQL connection if multi-tenant mode is configured
	if p.BaseDomain != "" && p.DBDSN != "" {
		db, err := sql.Open("postgres", p.DBDSN)
		if err != nil {
			return fmt.Errorf("static_s3: failed to open postgres: %w", err)
		}
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := db.PingContext(pingCtx); err != nil {
			return fmt.Errorf("static_s3: postgres ping failed: %w", err)
		}
		p.db = db
	}

	// Open Redis connection if multi-tenant mode is configured
	if p.BaseDomain != "" && p.RedisURL != "" {
		opts, err := redis.ParseURL(p.RedisURL)
		if err != nil {
			return fmt.Errorf("static_s3: invalid redis_url: %w", err)
		}
		rdb := redis.NewClient(opts)
		pingCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
		defer cancel()
		if err := rdb.Ping(pingCtx).Err(); err != nil {
			return fmt.Errorf("static_s3: redis ping failed: %w", err)
		}
		p.redisClient = rdb
	}

	// Initialize analytics middleware when both Redis and PostgreSQL are
	// available and the operator has not explicitly disabled it.
	if p.db != nil && p.redisClient != nil && p.AnalyticsEnabled {
		p.analytics = NewAnalyticsMiddleware(p.redisClient, p.db)
	}

	// SPA Fallback: hardcoded to "index.html" in multi-tenant mode.
	// Can be disabled by setting fallback to "none" or "" in single-tenant mode.
	if p.Fallback == "" {
		p.Fallback = "index.html"
	} else if p.Fallback == "none" || p.Fallback == `""` || p.Fallback == `''` {
		p.Fallback = ""
	}

	// Build AWS configuration options
	var opts []func(*config.LoadOptions) error
	opts = append(opts, config.WithRegion(p.Region))

	// Only use static credentials provider if access_key or secret_key is specified.
	// Otherwise, it falls back to AWS default credentials chain (env vars, ECS/EKS/EC2 IAM Roles).
	if p.AccessKey != "" || p.SecretKey != "" {
		opts = append(opts, config.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(p.AccessKey, p.SecretKey, ""),
		))
	}

	cfg, err := config.LoadDefaultConfig(ctx, opts...)
	if err != nil {
		return fmt.Errorf("static_s3: aws config failed: %w", err)
	}

	// Initialize S3 Client
	p.s3Client = s3.NewFromConfig(cfg, func(o *s3.Options) {
		if p.Endpoint != "" {
			o.BaseEndpoint = aws.String(p.Endpoint)
		}
		if p.UsePathStyle != nil {
			o.UsePathStyle = *p.UsePathStyle
		} else {
			o.UsePathStyle = true // Backward-compatible default
		}
	})

	// Parse Caching configs
	if p.CacheTTL != "" {
		ttl, err := caddy.ParseDuration(p.CacheTTL)
		if err != nil {
			return fmt.Errorf("static_s3: invalid cache_ttl: %w", err)
		}
		p.cacheTTL = ttl
	}

	if p.MaxCacheSize != "" {
		bytesVal, err := humanize.ParseBytes(p.MaxCacheSize)
		if err != nil {
			return fmt.Errorf("static_s3: invalid max_cache_size: %w", err)
		}
		p.maxCacheSize = int64(bytesVal)
	}

	if p.cacheTTL > 0 {
		size := p.CacheSize
		if size <= 0 {
			size = 1000 // Default cache capacity
		}
		p.cache = NewLRUCache(size, p.maxCacheSize)
	}

	// Initialize S3 Presign Client if redirect and presign are enabled
	if p.RedirectToS3 && p.PresignRedirect {
		p.s3PresignClient = s3.NewPresignClient(p.s3Client)
		if p.PresignLifetimeStr != "" {
			lifetime, err := caddy.ParseDuration(p.PresignLifetimeStr)
			if err != nil {
				return fmt.Errorf("static_s3: invalid presign_lifetime: %w", err)
			}
			p.presignLifetime = lifetime
		} else {
			p.presignLifetime = 15 * time.Minute // Default pre-signed URL validity
		}
	}

	return nil
}

// Cleanup implements caddy.CleanerUpper and is called by Caddy on reload or
// shutdown.  It signals both background goroutines to stop, waits for the
// final PostgreSQL flush to complete, and closes the database connection.
func (p *StaticPlugin) Cleanup() error {
	if p.analytics != nil {
		close(p.analytics.done) // signal both goroutines to stop
		p.analytics.wg.Wait()  // wait for final flush to complete
	}
	if p.db != nil {
		p.db.Close()
	}
	return nil
}

func parseCaddyfile(h httpcaddyfile.Helper) (caddyhttp.MiddlewareHandler, error) {
	var p StaticPlugin
	err := p.UnmarshalCaddyfile(h.Dispenser)
	return &p, err
}

func (p *StaticPlugin) UnmarshalCaddyfile(d *caddyfile.Dispenser) error {
	for d.Next() {
		for d.NextBlock(0) {
			switch d.Val() {
			case "endpoint":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.Endpoint = d.Val()
			case "bucket":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.Bucket = d.Val()
			case "access_key":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.AccessKey = d.Val()
			case "secret_key":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.SecretKey = d.Val()
			case "region":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.Region = d.Val()
			case "use_path_style":
				if !d.NextArg() {
					return d.ArgErr()
				}
				val := d.Val() == "true" || d.Val() == "yes" || d.Val() == "on"
				p.UsePathStyle = &val
			case "prefix":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.Prefix = d.Val()
			case "fallback":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.Fallback = d.Val()
			case "fallback_except":
				p.FallbackExcept = d.RemainingArgs()
				if len(p.FallbackExcept) == 0 {
					return d.ArgErr()
				}
			case "cache_ttl":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.CacheTTL = d.Val()
			case "cache_size":
				if !d.NextArg() {
					return d.ArgErr()
				}
				var val int
				if _, err := fmt.Sscan(d.Val(), &val); err != nil {
					return d.Errf("invalid cache_size: %v", err)
				}
				p.CacheSize = val
			case "max_cache_size":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.MaxCacheSize = d.Val()
			case "redirect_to_s3":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.RedirectToS3 = d.Val() == "true" || d.Val() == "yes" || d.Val() == "on"
			case "presign_redirect":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.PresignRedirect = d.Val() == "true" || d.Val() == "yes" || d.Val() == "on"
			case "presign_lifetime":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.PresignLifetimeStr = d.Val()
			case "base_domain":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.BaseDomain = d.Val()
			case "db_dsn":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.DBDSN = d.Val()
			case "redis_url":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.RedisURL = d.Val()
			case "analytics":
				if !d.NextArg() {
					return d.ArgErr()
				}
				p.AnalyticsEnabled = d.Val() == "true" || d.Val() == "yes" || d.Val() == "on"
			default:
				return d.Errf("unknown subdirective: %s", d.Val())
			}
		}
	}
	return nil
}
