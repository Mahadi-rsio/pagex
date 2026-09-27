// Package storage wraps the control-plane PostgreSQL database, the MinIO/S3
// object store, and the optional Upstash Redis cache used by the cleanup jobs.
//
// It reuses the console's and blob-server's environment names and its on-disk
// layout, so no new configuration or key scheme is introduced:
//
//	blobs/{sha256}                          content-addressed file bodies
//	manifests/{deploymentId}.manifest.json   immutable per-deployment index
package storage

import (
	"context"
	"database/sql"
	"fmt"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"

	"github.com/Mahadi-rsio/pagex-worker/internal/config"

	_ "github.com/lib/pq" // database/sql driver for PostgreSQL
)

// Store bundles the handles a cleanup handler needs.
type Store struct {
	DB     *sql.DB
	S3     *s3.Client
	Bucket string

	Redis *RedisCache

	// DeleteBatch bounds one S3 DeleteObjects call.
	DeleteBatch int
}

// New connects to PostgreSQL and the object store.
func New(ctx context.Context, cfg *config.Config) (*Store, error) {
	db, err := sql.Open("postgres", cfg.DatabaseURL)
	if err != nil {
		return nil, fmt.Errorf("open postgres: %w", err)
	}
	// The console connects with prepare:false for PgBouncer/Neon pooled
	// compatibility; the same applies here because the worker is long-lived
	// against the same pooled endpoint.
	db.SetMaxOpenConns(cfg.DatabaseMaxConns)
	db.SetMaxIdleConns(cfg.DatabaseMaxConns)
	db.SetConnMaxLifetime(30 * time.Minute)

	pingCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	if err := db.PingContext(pingCtx); err != nil {
		db.Close()
		return nil, fmt.Errorf("ping postgres: %w", err)
	}

	client, err := newS3Client(ctx, cfg)
	if err != nil {
		db.Close()
		return nil, err
	}

	store := &Store{
		DB:          db,
		S3:          client,
		Bucket:      cfg.Bucket,
		DeleteBatch: cfg.StorageDeleteBatch,
	}
	if cfg.RedisEnabled {
		store.Redis = NewRedisCache(cfg.RedisURL, cfg.RedisToken, cfg.StorageKeyPrefix())
	}

	return store, nil
}

func newS3Client(ctx context.Context, cfg *config.Config) (*s3.Client, error) {
	awsCfg, err := awsconfig.LoadDefaultConfig(
		ctx,
		awsconfig.WithRegion(cfg.Region),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.AccessKey, cfg.SecretKey, ""),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("load aws config: %w", err)
	}

	return s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(cfg.Endpoint)
		o.UsePathStyle = cfg.UsePathStyle
	}), nil
}

// Close releases the database pool.
func (s *Store) Close() error {
	if s.DB == nil {
		return nil
	}
	return s.DB.Close()
}

// Object keys. These must stay identical to
// services/console/src/server/api/infrastructure/storage/minio.ts.

// BlobObjectKey is the content-addressed key for a blob body.
func BlobObjectKey(hash string) string {
	return "blobs/" + hash
}

// ManifestObjectKey is the immutable manifest key for a deployment.
func ManifestObjectKey(deploymentID string) string {
	return "manifests/" + deploymentID + ".manifest.json"
}
