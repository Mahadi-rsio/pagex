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
)

const (
	manifestSchemaVersion = 1
	maxManifestSizeBytes  = 50 * 1024 * 1024
	// manifestL1TTL is the process-local manifest cache TTL. Manifests are
	// immutable and keyed by deployment ID, so no invalidation is ever needed —
	// a long TTL is safe and keeps hot-path requests entirely off MinIO.
	manifestL1TTL = 1 * time.Hour
	// activeDeploymentL1TTL bounds the process-local siteID→active deployment
	// mapping. Redis holds the durable pointer (repointed on deploy/rollback),
	// so this TTL is only how long a process may serve a stale deployment
	// before re-reading Redis. Keep it short so deploys become visible quickly.
	activeDeploymentL1TTL = 60 * time.Second
	// siteIDL1TTL bounds the process-local subdomain→siteID mapping. A
	// deactivated/deleted site stops being served within this window.
	siteIDL1TTL = 5 * time.Minute
	// manifestLoadErrorTTL negative-caches failed manifest loads so a missing or
	// corrupt manifest cannot stampede MinIO with one fetch per request.
	manifestLoadErrorTTL = 10 * time.Second
)

var (
	sha256HexRE     = regexp.MustCompile(`^[a-f0-9]{64}$`)
	sha256PrefixRE  = regexp.MustCompile(`^sha256:[a-f0-9]{64}$`)
	manifestLoading sync.Map // deploymentID → *manifestLoadGroup
	manifestErrors  sync.Map // deploymentID → manifestErrorEntry
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

// manifestErrorEntry negative-caches a failed manifest load for a short window
// to absorb concurrent requests for a missing/corrupt manifest.
type manifestErrorEntry struct {
	err       error
	expiresAt time.Time
}

// ServeMetrics tracks manifest and blob cache observability counters.
type ServeMetrics struct {
	ManifestL1Hit            int64
	ManifestL1Miss           int64
	ManifestObjectStorageHit int64
	ManifestLoadErrors       int64
	BlobCacheHit             int64
	BlobCacheMiss            int64
}

func manifestObjectKey(deploymentID string) string {
	return "manifests/" + deploymentID + ".manifest.json"
}

func activeDeploymentL1Key(siteID string) string {
	return siteID + ":__active__"
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

// activeDeploymentL1Key scopes the process-local active-deployment mapping by
// site. Deployments are immutable and keyed by deployment ID; the mapping is
// refreshed by TTL (activeDeploymentL1TTL) since there is no push invalidation.
func (p *StaticPlugin) cacheActiveDeployment(siteID, deploymentID string) {
	if p.cacheTTL <= 0 || p.cache == nil {
		return
	}
	key := activeDeploymentL1Key(siteID)
	p.cache.Set(key, &CacheItem{
		Key:     key,
		Content: []byte(deploymentID),
		Exists:  true,
	}, activeDeploymentL1TTL)
}

func (p *StaticPlugin) cacheActiveDeploymentNegative(siteID string) {
	if p.cacheTTL <= 0 || p.cache == nil {
		return
	}
	key := activeDeploymentL1Key(siteID)
	p.cache.Set(key, &CacheItem{
		Key:    key,
		Exists: false,
	}, activeDeploymentL1TTL)
}

// resolveActiveDeploymentID resolves siteID → active deployment ID. Lookup
// order is process-local LRU → Redis → PostgreSQL. Deploys/rollbacks repoint
// the Redis key; Postgres stays authoritative and backfills Redis on a miss.
func (p *StaticPlugin) resolveActiveDeploymentID(ctx context.Context, siteID string) (string, error) {
	// L1: process-local LRU (siteID → active deployment ID). A hit means zero
	// external work on the hot path.
	l1Key := activeDeploymentL1Key(siteID)
	if p.cacheTTL > 0 && p.cache != nil {
		if item, ok := p.cache.Get(l1Key); ok {
			if !item.Exists {
				return "", nil
			}
			if len(item.Content) > 0 {
				return string(item.Content), nil
			}
		}
	}

	// L2: Redis (durable distributed lookup). A Redis failure is non-fatal. A
	// malformed value is ignored so PostgreSQL repairs the mapping.
	if p.routing != nil {
		deploymentID, ok, err := p.routing.Get(ctx, activeDeploymentRoutingKey(siteID))
		switch {
		case err != nil:
			p.warnRouting("active_deployment", siteID, err)
		case ok && deploymentID != "" && isUUID(deploymentID):
			p.cacheActiveDeployment(siteID, deploymentID)
			return deploymentID, nil
		case ok && deploymentID != "":
			p.warnMalformedRouting("active_deployment", siteID, deploymentID)
		}
	}

	// L3: PostgreSQL fallback (control-plane source of truth).
	if p.store == nil {
		return "", fmt.Errorf("static_s3: active deployment lookup requires db_dsn")
	}

	deploymentID, found, err := p.store.ActiveDeploymentBySite(ctx, siteID)
	if err != nil {
		return "", fmt.Errorf("static_s3: active deployment query error: %w", err)
	}
	if !found {
		p.cacheActiveDeploymentNegative(siteID)
		return "", nil
	}

	p.cacheActiveDeployment(siteID, deploymentID)

	// Backfill Redis with the 1h safety TTL.
	if p.routing != nil {
		if err := p.routing.Set(ctx, activeDeploymentRoutingKey(siteID), deploymentID, activeDeploymentRedisTTLSeconds); err != nil {
			p.warnRouting("active_deployment", siteID, err)
		}
	}

	return deploymentID, nil
}

func (p *StaticPlugin) loadManifest(ctx context.Context, deploymentID string) (*DeploymentManifest, error) {
	if deploymentID == "" {
		return nil, errors.New("empty deployment id")
	}

	// Fast-fail on a recently failed load (missing/corrupt manifest) so a
	// stampede cannot turn into one MinIO fetch per request.
	if entry, ok := manifestErrors.Load(deploymentID); ok {
		e := entry.(manifestErrorEntry)
		if time.Now().Before(e.expiresAt) {
			if p.metrics != nil {
				p.metrics.ManifestLoadErrors++
			}
			return nil, e.err
		}
		manifestErrors.Delete(deploymentID)
	}

	l1Key := "manifest:" + deploymentID
	if p.manifestCache != nil {
		if m, ok := p.manifestCache.Get(l1Key); ok {
			if p.metrics != nil {
				p.metrics.ManifestL1Hit++
			}
			return m, nil
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
		// Re-check the negative cache inside the single-flight body: a concurrent
		// load may have failed and recorded the error between our check above and
		// acquiring the group.
		if entry, ok := manifestErrors.Load(deploymentID); ok && time.Now().Before(entry.(manifestErrorEntry).expiresAt) {
			group.err = entry.(manifestErrorEntry).err
			return
		}
		group.manifest, group.err = p.loadManifestFromRemote(ctx, deploymentID)
		if group.err != nil {
			manifestErrors.Store(deploymentID, manifestErrorEntry{
				err:       group.err,
				expiresAt: time.Now().Add(manifestLoadErrorTTL),
			})
		} else if group.manifest != nil {
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

	return m, nil
}

func (p *StaticPlugin) populateManifestCaches(deploymentID string, manifest *DeploymentManifest) {
	if manifest == nil {
		return
	}
	l1Key := "manifest:" + deploymentID
	if p.manifestCache != nil {
		p.manifestCache.Set(l1Key, manifest, manifestL1TTL)
	}
}

func manifestContentHash(raw []byte) string {
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
