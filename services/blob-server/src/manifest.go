package cdx_s3

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/redis/go-redis/v9"
)

const (
	manifestSchemaVersion = 1
	maxManifestSizeBytes  = 50 * 1024 * 1024
	manifestRedisTTL      = 24 * time.Hour
)

var (
	sha256HexRE     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	sha256PrefixRE  = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	manifestLoading sync.Map // deploymentID → *manifestLoadGroup
)

// DeploymentManifest is the immutable runtime index for a finalized deployment.
type DeploymentManifest struct {
	Version      int               `json:"version"`
	DeploymentID string            `json:"deploymentId"`
	Files        map[string]string `json:"files"`
}

type manifestLoadGroup struct {
	done     chan struct{}
	once     sync.Once
	manifest *DeploymentManifest
	err      error
}

// ServeMetrics tracks manifest and blob cache observability counters.
type ServeMetrics struct {
	ManifestL1Hit            int64
	ManifestL1Miss           int64
	ManifestRedisHit         int64
	ManifestRedisMiss        int64
	ManifestObjectStorageHit int64
	ManifestLoadErrors       int64
	BlobCacheHit             int64
	BlobCacheMiss            int64
}

func manifestObjectKey(deploymentID string) string {
	return "manifests/" + deploymentID + ".manifest.json"
}

func manifestRedisKey(deploymentID string) string {
	return "manifest:" + deploymentID
}

func activeDeploymentRedisKey(siteID string) string {
	return "active_deployment:" + siteID
}

// normalizeManifestPath canonicalizes request paths for manifest lookup.
func normalizeManifestPath(raw string) (string, bool) {
	if raw == "" || strings.Contains(raw, "\x00") {
		return "", false
	}

	p := strings.TrimSpace(raw)
	if strings.HasPrefix(p, "/") {
		p = p[1:]
	}

	lower := strings.ToLower(p)
	if strings.Contains(lower, "..") ||
		strings.Contains(lower, "%2e") ||
		strings.Contains(lower, "%2f") ||
		strings.Contains(lower, "\\") {
		return "", false
	}

	for strings.Contains(p, "//") {
		p = strings.ReplaceAll(p, "//", "/")
	}
	if strings.HasPrefix(p, "/") {
		p = p[1:]
	}
	if strings.Contains(p, "..") {
		return "", false
	}

	return p, true
}

func normalizeBlobHash(hash string) (string, bool) {
	if sha256HexRE.MatchString(hash) {
		return strings.ToLower(hash), true
	}
	if sha256PrefixRE.MatchString(strings.ToLower(hash)) {
		return strings.ToLower(hash[7:]), true
	}
	return "", false
}

func validateDeploymentManifest(raw []byte, expectedDeploymentID string) (*DeploymentManifest, error) {
	if len(raw) > maxManifestSizeBytes {
		return nil, fmt.Errorf("manifest exceeds maximum size (%d bytes)", maxManifestSizeBytes)
	}

	var m DeploymentManifest
	if err := json.Unmarshal(raw, &m); err != nil {
		return nil, fmt.Errorf("manifest parse error: %w", err)
	}

	if m.Version != manifestSchemaVersion {
		return nil, fmt.Errorf("unsupported manifest version: %d", m.Version)
	}
	if m.DeploymentID == "" {
		return nil, errors.New("missing deploymentId")
	}
	if expectedDeploymentID != "" && m.DeploymentID != expectedDeploymentID {
		return nil, errors.New("deploymentId mismatch")
	}
	if m.Files == nil {
		return nil, errors.New("files must be an object")
	}

	clean := make(map[string]string, len(m.Files))
	seen := make(map[string]struct{}, len(m.Files))

	for rawPath, rawHash := range m.Files {
		path, ok := normalizeManifestPath(rawPath)
		if !ok {
			return nil, fmt.Errorf("invalid path: %q", rawPath)
		}
		if _, dup := seen[path]; dup {
			return nil, fmt.Errorf("duplicate path: %q", path)
		}
		seen[path] = struct{}{}

		hash, ok := normalizeBlobHash(rawHash)
		if !ok {
			return nil, fmt.Errorf("invalid blob hash for path %q", path)
		}
		clean[path] = hash
	}

	m.Files = clean
	return &m, nil
}

func (p *StaticPlugin) resolveActiveDeploymentID(ctx context.Context, siteID string) (string, error) {
	if p.redisClient != nil {
		val, err := p.redisClient.Get(ctx, activeDeploymentRedisKey(siteID)).Result()
		if err == nil && val != "" {
			return val, nil
		}
	}

	if p.db == nil {
		return "", fmt.Errorf("static_s3: active deployment lookup requires db_dsn or warm Redis cache")
	}

	var deploymentID string
	row := p.db.QueryRowContext(ctx, `
		SELECT id FROM deployments
		WHERE site_id = $1 AND is_active = true AND manifest_key IS NOT NULL
		LIMIT 1
	`, siteID)
	if err := row.Scan(&deploymentID); err != nil {
		if errors.Is(err, errNoRows) {
			return "", nil
		}
		return "", fmt.Errorf("static_s3: active deployment query error: %w", err)
	}

	if p.redisClient != nil && deploymentID != "" {
		_ = p.redisClient.Set(ctx, activeDeploymentRedisKey(siteID), deploymentID, 0).Err()
	}

	return deploymentID, nil
}

func (p *StaticPlugin) loadManifest(ctx context.Context, deploymentID string) (*DeploymentManifest, error) {
	if deploymentID == "" {
		return nil, errors.New("empty deployment id")
	}

	l1Key := "manifest:" + deploymentID
	if p.manifestCache != nil {
		if raw, ok := p.manifestCache.Get(l1Key); ok {
			if m, err := validateDeploymentManifest(raw, deploymentID); err == nil {
				if p.metrics != nil {
					p.metrics.ManifestL1Hit++
				}
				return m, nil
			}
		}
		if p.metrics != nil {
			p.metrics.ManifestL1Miss++
		}
	}

	return p.loadManifestCoalesced(ctx, deploymentID)
}

func (p *StaticPlugin) loadManifestCoalesced(ctx context.Context, deploymentID string) (*DeploymentManifest, error) {
	groupVal, _ := manifestLoading.LoadOrStore(deploymentID, &manifestLoadGroup{
		done: make(chan struct{}),
	})
	group := groupVal.(*manifestLoadGroup)

	group.once.Do(func() {
		defer close(group.done)
		group.manifest, group.err = p.loadManifestFromRemote(ctx, deploymentID)
		if group.err == nil && group.manifest != nil {
			p.populateManifestCaches(deploymentID, group.manifest)
		}
		manifestLoading.Delete(deploymentID)
	})

	<-group.done
	if group.err != nil {
		return nil, group.err
	}
	return group.manifest, nil
}

func (p *StaticPlugin) loadManifestFromRemote(ctx context.Context, deploymentID string) (*DeploymentManifest, error) {
	if p.redisClient != nil {
		val, err := p.redisClient.Get(ctx, manifestRedisKey(deploymentID)).Result()
		if err == nil && val != "" {
			m, vErr := validateDeploymentManifest([]byte(val), deploymentID)
			if vErr != nil {
				if p.metrics != nil {
					p.metrics.ManifestLoadErrors++
				}
				return nil, vErr
			}
			if p.metrics != nil {
				p.metrics.ManifestRedisHit++
			}
			return m, nil
		}
		if err != nil && !errors.Is(err, redis.Nil) {
			// Redis unavailable — fall through to MinIO
		} else if p.metrics != nil {
			p.metrics.ManifestRedisMiss++
		}
	}

	if p.s3Client == nil {
		return nil, errors.New("static_s3: manifest load requires S3 client")
	}

	result, err := p.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.Bucket),
		Key:    aws.String(manifestObjectKey(deploymentID)),
	})
	if err != nil {
		if p.metrics != nil {
			p.metrics.ManifestLoadErrors++
		}
		return nil, fmt.Errorf("static_s3: manifest object load error: %w", err)
	}
	defer result.Body.Close()

	raw, err := io.ReadAll(io.LimitReader(result.Body, maxManifestSizeBytes+1))
	if err != nil {
		if p.metrics != nil {
			p.metrics.ManifestLoadErrors++
		}
		return nil, fmt.Errorf("static_s3: manifest read error: %w", err)
	}

	m, err := validateDeploymentManifest(raw, deploymentID)
	if err != nil {
		if p.metrics != nil {
			p.metrics.ManifestLoadErrors++
		}
		return nil, err
	}

	if p.metrics != nil {
		p.metrics.ManifestObjectStorageHit++
	}

	if p.redisClient != nil {
		_ = p.redisClient.Set(ctx, manifestRedisKey(deploymentID), string(raw), manifestRedisTTL).Err()
	}

	return m, nil
}

func (p *StaticPlugin) populateManifestCaches(deploymentID string, manifest *DeploymentManifest) {
	if manifest == nil {
		return
	}
	raw, err := json.Marshal(manifest)
	if err != nil {
		return
	}
	l1Key := "manifest:" + deploymentID
	if p.manifestCache != nil && p.cacheTTL > 0 {
		p.manifestCache.Set(l1Key, raw, p.cacheTTL)
	}
}

func manifestContentHash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
