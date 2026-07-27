package cdx_s3

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/aws/smithy-go"
	"github.com/caddyserver/caddy/v2/modules/caddyhttp"
	"github.com/redis/go-redis/v9"
)

// siteFilesRebuilding dedupes concurrent site_files:{site_id} Redis rebuilds.
var siteFilesRebuilding sync.Map // siteID → struct{}

// blobResolution holds the result of resolving a request path to a content-addressed blob.
type blobResolution struct {
	BlobHash        string
	ContentEncoding string // "br", "gzip", or ""
	FilePath        string // site path used for Content-Type / Cache-Control (no .br/.gz)
	EncodingKey     string // cache key encoding: br, gz, webp, raw
}

// ServeHTTP implements caddyhttp.MiddlewareHandler.
func (p *StaticPlugin) ServeHTTP(w http.ResponseWriter, r *http.Request, next caddyhttp.Handler) error {
	urlPath := r.URL.Path

	// ── Multi-tenant mode ──────────────────────────────────────────────────
	if p.BaseDomain != "" {
		// 1. Extract subdomain from Host header
		host := r.Host
		if h, _, err := splitHostPort(host); err == nil {
			host = h
		}

		suffix := "." + p.BaseDomain
		if !strings.HasSuffix(host, suffix) {
			return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("host %q does not match base domain", host))
		}
		subdomain := strings.TrimSuffix(host, suffix)
		if subdomain == "" || strings.Contains(subdomain, ".") {
			return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("invalid subdomain %q", subdomain))
		}

		// 2. Resolve site_id via Redis → PostgreSQL
		siteID, err := p.resolveSiteID(r.Context(), subdomain)
		if err != nil {
			return caddyhttp.Error(http.StatusInternalServerError, err)
		}
		if siteID == "" {
			return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("tenant %q not found", subdomain))
		}

		// 2b. Deploy version for instant LRU invalidation (never blocks on failure)
		version := p.resolveSiteVersion(r.Context(), subdomain, siteID)

		encKey := requestEncodingKey(r, urlPath)
		cacheKey := subdomain + ":" + version + ":" + urlPath + ":" + encKey
		negKey := subdomain + ":" + version + ":" + urlPath + ":404"
		bodyKey := subdomain + ":" + version + ":" + urlPath + ":" + encKey + ":body"

		rec := caddyhttp.NewResponseRecorder(w, nil, nil)

		// Path / encoding LRU cache (version-scoped)
		if p.cacheTTL > 0 && p.cache != nil {
			if item, ok := p.cache.Get(negKey); ok && !item.Exists {
				return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("cached 404 for path: %s", urlPath))
			}
			if item, ok := p.cache.Get(cacheKey); ok {
				if !item.Exists {
					return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("cached 404 for path: %s", urlPath))
				}
				// Path-resolution hit → skip Redis, go to MinIO (or memory)
				if item.BlobHash != "" {
					err = p.serveBlob(rec, r, item.BlobHash, item.FilePath, item.ContentEncoding, bodyKey, item)
					if err != nil {
						return caddyhttp.Error(http.StatusNotFound, err)
					}
					rec.WriteResponse()
					p.recordAnalytics(siteID, r, rec)
					return nil
				}
			}
		}

		// 3–6. Resolve path via site_files Redis map (with PG rebuild fallback)
		resolved, err := p.resolveBlob(r.Context(), siteID, subdomain, urlPath, r)
		if err != nil {
			return caddyhttp.Error(http.StatusInternalServerError, err)
		}
		if resolved == nil {
			if p.cacheTTL > 0 && p.cache != nil {
				p.cache.Set(negKey, &CacheItem{Key: negKey, Exists: false}, 1*time.Minute)
			}
			return caddyhttp.Error(http.StatusNotFound, fmt.Errorf("file not found for path: %s", urlPath))
		}

		// Cache path → blob_hash resolution (body cached separately under bodyKey)
		if p.cacheTTL > 0 && p.cache != nil {
			p.cache.Set(cacheKey, &CacheItem{
				Key:             cacheKey,
				BlobHash:        resolved.BlobHash,
				ContentEncoding: resolved.ContentEncoding,
				FilePath:        resolved.FilePath,
				ContentType:     contentTypeForPath(resolved.FilePath),
				Exists:          true,
			}, p.cacheTTL)
		}

		err = p.serveBlob(rec, r, resolved.BlobHash, resolved.FilePath, resolved.ContentEncoding, bodyKey, nil)
		if err != nil {
			return caddyhttp.Error(http.StatusNotFound, err)
		}

		rec.WriteResponse()
		p.recordAnalytics(siteID, r, rec)
		return nil
	}

	// ── Single-tenant mode (existing behaviour) ────────────────────────────
	path := urlPath
	key := strings.TrimPrefix(path, "/")
	if p.Prefix != "" {
		key = filepath.Join(p.Prefix, key)
		key = filepath.ToSlash(key)
	}

	isFallbackRequest := false
	if p.Fallback != "" {
		if path == "/" || path == "" || (!hasExtension(path) && !p.isExcludedFromFallback(path)) {
			key = p.Fallback
			isFallbackRequest = true
		}
	}

	err := p.serveObject(w, r, key, isFallbackRequest)
	if err != nil {
		if p.Fallback != "" && !isFallbackRequest && p.isNotFoundError(err) && !p.isExcludedFromFallback(path) {
			return p.serveObject(w, r, p.Fallback, true)
		}
		return caddyhttp.Error(http.StatusNotFound, err)
	}

	return nil
}

func (p *StaticPlugin) recordAnalytics(siteID string, r *http.Request, rec caddyhttp.ResponseRecorder) {
	if p.analytics == nil {
		return
	}
	ip := r.RemoteAddr
	if idx := strings.LastIndex(ip, ":"); idx != -1 {
		ip = ip[:idx]
	}
	p.analytics.Record(
		siteID,
		rec.Status(),
		int64(rec.Size()),
		r.Header.Get("User-Agent"),
		ip,
	)
}

// resolveSiteID looks up the site UUID for a given subdomain, using Redis as a
// read-through cache backed by PostgreSQL.
func (p *StaticPlugin) resolveSiteID(ctx context.Context, subdomain string) (string, error) {
	redisKey := "site:" + subdomain

	// 1. Redis cache lookup
	if p.redisClient != nil {
		val, err := p.redisClient.Get(ctx, redisKey).Result()
		if err == nil {
			if val == "NOT_FOUND" {
				return "", nil
			}
			return val, nil
		}
		if !errors.Is(err, redis.Nil) {
			_ = err // unexpected — fall through to DB
		} else {
			// Redis miss for site: key → backend invalidated after deploy.
			// Evict only the cached version so the next lookup fetches site_version fresh.
			// Old version-scoped LRU entries become unreachable without a prefix scan.
			if p.cache != nil {
				p.cache.Delete(subdomain + ":__version__")
			}
		}
	}

	// 2. PostgreSQL lookup
	if p.db == nil {
		return "", fmt.Errorf("static_s3: multi-tenant mode requires db_dsn")
	}

	var siteID string
	row := p.db.QueryRowContext(ctx,
		"SELECT id FROM sites WHERE subdomain = $1 AND active = true LIMIT 1",
		subdomain,
	)
	err := row.Scan(&siteID)
	if err != nil {
		if errors.Is(err, errNoRows) {
			if p.redisClient != nil {
				_ = p.redisClient.Set(ctx, redisKey, "NOT_FOUND", 1*time.Minute).Err()
			}
			return "", nil
		}
		return "", fmt.Errorf("static_s3: db query error: %w", err)
	}

	if p.redisClient != nil {
		_ = p.redisClient.Set(ctx, redisKey, siteID, 5*time.Minute).Err()
	}

	return siteID, nil
}

// resolveSiteVersion returns the deploy version for a site used to scope LRU keys.
// On any Redis failure or missing key, returns "0" without blocking the request.
func (p *StaticPlugin) resolveSiteVersion(ctx context.Context, subdomain, siteID string) string {
	versionKey := subdomain + ":__version__"

	if p.cacheTTL > 0 && p.cache != nil {
		if item, ok := p.cache.Get(versionKey); ok && item.Exists && len(item.Content) > 0 {
			return string(item.Content)
		}
	}

	version := "0"
	if p.redisClient != nil {
		val, err := p.redisClient.Get(ctx, "site_version:"+siteID).Result()
		if err == nil && val != "" {
			version = val
		}
		// redis.Nil or any error → keep "0"
	}

	if p.cacheTTL > 0 && p.cache != nil {
		p.cache.Set(versionKey, &CacheItem{
			Key:     versionKey,
			Content: []byte(version),
			Exists:  true,
		}, p.cacheTTL)
	}

	return version
}

// resolveBlob maps a request URL path to a blob hash via the site_files Redis
// hash, with PostgreSQL rebuild fallback when the Redis key has expired.
func (p *StaticPlugin) resolveBlob(ctx context.Context, siteID, subdomain, urlPath string, r *http.Request) (*blobResolution, error) {
	candidates := pathCandidates(urlPath)
	ae := r.Header.Get("Accept-Encoding")
	accept := r.Header.Get("Accept")
	encKey := requestEncodingKey(r, urlPath)

	// Try Redis site_files map first
	if p.redisClient != nil {
		filesKey := "site_files:" + siteID
		exists, err := p.redisClient.Exists(ctx, filesKey).Result()
		if err != nil {
			exists = 0
		}

		if exists > 0 {
			for _, candidate := range candidates {
				if res := p.pickVariantRedis(ctx, filesKey, candidate, ae, accept); res != nil {
					res.EncodingKey = encKey
					return res, nil
				}
			}
			// SPA fallback
			if p.Fallback != "" && !p.isExcludedFromFallback(urlPath) {
				if res := p.pickVariantRedis(ctx, filesKey, "index.html", ae, accept); res != nil {
					res.EncodingKey = encKey
					return res, nil
				}
			}
			return nil, nil
		}
	}

	// site_files key missing (or no Redis) → PostgreSQL fallback
	entries, err := p.loadBlobTreeFromDB(ctx, siteID)
	if err != nil {
		return nil, err
	}
	if len(entries) == 0 {
		return nil, nil
	}

	// Rebuild Redis in background; serve this request from PG result immediately
	p.scheduleSiteFilesRebuild(siteID, entries)

	for _, candidate := range candidates {
		if res := pickVariantMap(entries, candidate, ae, accept); res != nil {
			res.EncodingKey = encKey
			return res, nil
		}
	}
	if p.Fallback != "" && !p.isExcludedFromFallback(urlPath) {
		if res := pickVariantMap(entries, "index.html", ae, accept); res != nil {
			res.EncodingKey = encKey
			return res, nil
		}
	}
	return nil, nil
}

// pickVariantRedis selects the best pre-compressed / format variant via HGET only.
func (p *StaticPlugin) pickVariantRedis(ctx context.Context, filesKey, candidate, acceptEncoding, accept string) *blobResolution {
	if isImagePath(candidate) && acceptsWebP(accept) {
		if hash, ok := p.hget(ctx, filesKey, candidate+".webp"); ok {
			return &blobResolution{
				BlobHash: hash,
				FilePath: candidate + ".webp",
			}
		}
	}

	if acceptsToken(acceptEncoding, "br") {
		if hash, ok := p.hget(ctx, filesKey, candidate+".br"); ok {
			return &blobResolution{
				BlobHash:        hash,
				ContentEncoding: "br",
				FilePath:        candidate,
			}
		}
		if hash, ok := p.hget(ctx, filesKey, candidate); ok {
			return &blobResolution{BlobHash: hash, FilePath: candidate}
		}
		return nil
	}

	if acceptsToken(acceptEncoding, "gzip") {
		if hash, ok := p.hget(ctx, filesKey, candidate+".gz"); ok {
			return &blobResolution{
				BlobHash:        hash,
				ContentEncoding: "gzip",
				FilePath:        candidate,
			}
		}
		if hash, ok := p.hget(ctx, filesKey, candidate); ok {
			return &blobResolution{BlobHash: hash, FilePath: candidate}
		}
		return nil
	}

	if hash, ok := p.hget(ctx, filesKey, candidate); ok {
		return &blobResolution{BlobHash: hash, FilePath: candidate}
	}
	return nil
}

func (p *StaticPlugin) hget(ctx context.Context, key, field string) (string, bool) {
	val, err := p.redisClient.HGet(ctx, key, field).Result()
	if err != nil || val == "" {
		return "", false
	}
	return val, true
}

// pickVariantMap is the in-memory equivalent of pickVariantRedis for PG results.
func pickVariantMap(entries map[string]string, candidate, acceptEncoding, accept string) *blobResolution {
	if isImagePath(candidate) && acceptsWebP(accept) {
		if hash, ok := entries[candidate+".webp"]; ok && hash != "" {
			return &blobResolution{BlobHash: hash, FilePath: candidate + ".webp"}
		}
	}

	if acceptsToken(acceptEncoding, "br") {
		if hash, ok := entries[candidate+".br"]; ok && hash != "" {
			return &blobResolution{BlobHash: hash, ContentEncoding: "br", FilePath: candidate}
		}
		if hash, ok := entries[candidate]; ok && hash != "" {
			return &blobResolution{BlobHash: hash, FilePath: candidate}
		}
		return nil
	}

	if acceptsToken(acceptEncoding, "gzip") {
		if hash, ok := entries[candidate+".gz"]; ok && hash != "" {
			return &blobResolution{BlobHash: hash, ContentEncoding: "gzip", FilePath: candidate}
		}
		if hash, ok := entries[candidate]; ok && hash != "" {
			return &blobResolution{BlobHash: hash, FilePath: candidate}
		}
		return nil
	}

	if hash, ok := entries[candidate]; ok && hash != "" {
		return &blobResolution{BlobHash: hash, FilePath: candidate}
	}
	return nil
}

func (p *StaticPlugin) loadBlobTreeFromDB(ctx context.Context, siteID string) (map[string]string, error) {
	if p.db == nil {
		return nil, fmt.Errorf("static_s3: multi-tenant mode requires db_dsn")
	}

	rows, err := p.db.QueryContext(ctx, `
		SELECT bte.path, bte.blob_hash
		FROM blob_tree_entries bte
		INNER JOIN deployments d ON d.id = bte.deployment_id
		WHERE d.is_active = true AND d.site_id = $1
	`, siteID)
	if err != nil {
		return nil, fmt.Errorf("static_s3: blob tree query error: %w", err)
	}
	defer rows.Close()

	entries := make(map[string]string)
	for rows.Next() {
		var path, hash string
		if err := rows.Scan(&path, &hash); err != nil {
			return nil, fmt.Errorf("static_s3: blob tree scan error: %w", err)
		}
		entries[path] = hash
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("static_s3: blob tree rows error: %w", err)
	}
	return entries, nil
}

func (p *StaticPlugin) scheduleSiteFilesRebuild(siteID string, entries map[string]string) {
	if p.redisClient == nil {
		return
	}
	if _, loaded := siteFilesRebuilding.LoadOrStore(siteID, struct{}{}); loaded {
		return
	}
	go func() {
		defer siteFilesRebuilding.Delete(siteID)
		p.rebuildSiteFiles(siteID, entries)
	}()
}

func (p *StaticPlugin) rebuildSiteFiles(siteID string, entries map[string]string) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	key := "site_files:" + siteID
	pipe := p.redisClient.Pipeline()
	pipe.Del(ctx, key)
	if len(entries) > 0 {
		fields := make([]interface{}, 0, len(entries)*2)
		for path, hash := range entries {
			fields = append(fields, path, hash)
		}
		pipe.HSet(ctx, key, fields...)
		pipe.Expire(ctx, key, 24*time.Hour)
	}
	_, _ = pipe.Exec(ctx)
}

// serveBlob streams blobs/{hash} from MinIO with correct Content-Type / encoding headers.
// bodyKey is the version-scoped LRU key for file content/metadata ("…:body").
// cachedItem, when non-nil, is a warm path-resolution entry (blob hash / encoding / path).
func (p *StaticPlugin) serveBlob(w http.ResponseWriter, r *http.Request, blobHash, filePath, contentEncoding, bodyKey string, cachedItem *CacheItem) error {
	s3Key := blobObjectKey(blobHash)
	contentType := contentTypeForPath(filePath)
	cacheControl := cacheControlForPath(filePath)

	applyBlobHeaders := func(hdr http.Header) {
		hdr.Set("Content-Type", contentType)
		hdr.Set("Cache-Control", cacheControl)
		if contentEncoding != "" {
			hdr.Set("Content-Encoding", contentEncoding)
			hdr.Set("Vary", "Accept-Encoding")
		}
	}

	// Prefer body cache for content / conditional metadata
	if p.cacheTTL > 0 && p.cache != nil {
		if item, ok := p.cache.Get(bodyKey); ok {
			if !item.Exists {
				return fmt.Errorf("cached 404 for blob: %s", blobHash)
			}
			if p.RedirectToS3 {
				return p.redirectToS3(w, r, s3Key)
			}
			if item.ContentType == "" {
				item.ContentType = contentType
			}
			if item.ContentEncoding == "" {
				item.ContentEncoding = contentEncoding
			}
			if item.FilePath == "" {
				item.FilePath = filePath
			}
			if p.checkConditionalHeaders(w, r, item) {
				return nil
			}
			if item.Content != nil {
				applyBlobHeaders(w.Header())
				return p.serveCachedContent(w, r, item)
			}
		}
	}

	// Path-resolution entry may carry encoding/path hints but not body
	if cachedItem != nil && cachedItem.Exists {
		if cachedItem.ContentType == "" {
			cachedItem.ContentType = contentType
		}
		if cachedItem.ContentEncoding == "" {
			cachedItem.ContentEncoding = contentEncoding
		}
		if cachedItem.FilePath == "" {
			cachedItem.FilePath = filePath
		}
		if p.RedirectToS3 {
			return p.redirectToS3(w, r, s3Key)
		}
		if cachedItem.Content != nil {
			applyBlobHeaders(w.Header())
			return p.serveCachedContent(w, r, cachedItem)
		}
	}

	if p.RedirectToS3 {
		headResult, err := p.s3Client.HeadObject(r.Context(), &s3.HeadObjectInput{
			Bucket: aws.String(p.Bucket),
			Key:    aws.String(s3Key),
		})
		if err != nil {
			if p.isNotFoundError(err) && p.cacheTTL > 0 && p.cache != nil {
				p.cache.Set(bodyKey, &CacheItem{Key: bodyKey, Exists: false}, 1*time.Minute)
			}
			return err
		}
		if p.cacheTTL > 0 && p.cache != nil {
			etag := ""
			if headResult.ETag != nil {
				etag = *headResult.ETag
			}
			lastModified := time.Now()
			if headResult.LastModified != nil {
				lastModified = *headResult.LastModified
			}
			p.cache.Set(bodyKey, &CacheItem{
				Key:             bodyKey,
				BlobHash:        blobHash,
				ETag:            etag,
				LastModified:    lastModified,
				Size:            *headResult.ContentLength,
				ContentType:     contentType,
				ContentEncoding: contentEncoding,
				FilePath:        filePath,
				Exists:          true,
			}, p.cacheTTL)
		}
		return p.redirectToS3(w, r, s3Key)
	}

	input := &s3.GetObjectInput{
		Bucket: aws.String(p.Bucket),
		Key:    aws.String(s3Key),
	}
	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		input.Range = aws.String(rangeHeader)
	}
	if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch != "" {
		input.IfNoneMatch = aws.String(ifNoneMatch)
	}
	if ifModifiedSince := r.Header.Get("If-Modified-Since"); ifModifiedSince != "" {
		if t, err := http.ParseTime(ifModifiedSince); err == nil {
			input.IfModifiedSince = &t
		}
	}

	result, err := p.s3Client.GetObject(r.Context(), input)
	if err != nil {
		if p.isNotModifiedError(err) {
			if p.cacheTTL > 0 && p.cache != nil {
				if item, ok := p.cache.Get(bodyKey); ok {
					p.cache.Set(bodyKey, item, p.cacheTTL)
				}
			}
			w.WriteHeader(http.StatusNotModified)
			return nil
		}
		if p.isNotFoundError(err) && p.cacheTTL > 0 && p.cache != nil {
			p.cache.Set(bodyKey, &CacheItem{Key: bodyKey, Exists: false}, 1*time.Minute)
		}
		return err
	}
	defer result.Body.Close()

	etag := ""
	if result.ETag != nil {
		etag = *result.ETag
	}
	lastModified := time.Now()
	if result.LastModified != nil {
		lastModified = *result.LastModified
	}
	isRangeResponse := result.ContentRange != nil && *result.ContentRange != ""
	size := int64(0)
	if result.ContentLength != nil {
		size = *result.ContentLength
	}

	if etag != "" {
		w.Header().Set("ETag", etag)
	}
	w.Header().Set("Last-Modified", lastModified.UTC().Format(http.TimeFormat))
	applyBlobHeaders(w.Header())
	w.Header().Set("Accept-Ranges", "bytes")
	if isRangeResponse {
		w.Header().Set("Content-Range", *result.ContentRange)
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		w.WriteHeader(http.StatusOK)
	}

	canCacheContent := p.cacheTTL > 0 && p.maxCacheSize > 0 && size <= p.maxCacheSize && !isRangeResponse
	if canCacheContent {
		data, readErr := io.ReadAll(result.Body)
		if readErr != nil {
			return readErr
		}
		p.cache.Set(bodyKey, &CacheItem{
			Key:             bodyKey,
			BlobHash:        blobHash,
			ETag:            etag,
			LastModified:    lastModified,
			Size:            size,
			ContentType:     contentType,
			ContentEncoding: contentEncoding,
			FilePath:        filePath,
			Content:         data,
			Exists:          true,
		}, p.cacheTTL)
		_, writeErr := w.Write(data)
		return writeErr
	}
	if p.cacheTTL > 0 && !isRangeResponse {
		p.cache.Set(bodyKey, &CacheItem{
			Key:             bodyKey,
			BlobHash:        blobHash,
			ETag:            etag,
			LastModified:    lastModified,
			Size:            size,
			ContentType:     contentType,
			ContentEncoding: contentEncoding,
			FilePath:        filePath,
			Exists:          true,
		}, p.cacheTTL)
	}
	_, writeErr := io.Copy(w, result.Body)
	return writeErr
}

// splitHostPort splits host and port, tolerating missing port.
func splitHostPort(hostport string) (host, port string, err error) {
	host = hostport
	if i := strings.LastIndex(hostport, ":"); i >= 0 {
		possiblePort := hostport[i+1:]
		allDigits := true
		for _, c := range possiblePort {
			if c < '0' || c > '9' {
				allDigits = false
				break
			}
		}
		if allDigits && len(possiblePort) > 0 {
			host = hostport[:i]
			port = possiblePort
			return host, port, nil
		}
	}
	return host, "", fmt.Errorf("no port")
}

// errNoRows is a package-level alias so handler.go does not import database/sql.
var errNoRows = errSQLNoRows()

// serveObject fetches the file from S3 (or cache) and writes it to the response writer, or redirects the client.
func (p *StaticPlugin) serveObject(w http.ResponseWriter, r *http.Request, key string, isFallback bool) error {
	// 1. Check Cache first (if enabled)
	if p.cacheTTL > 0 && p.cache != nil {
		if item, ok := p.cache.Get(key); ok {
			if !item.Exists {
				return fmt.Errorf("cached 404 for key: %s", key)
			}

			if p.RedirectToS3 {
				return p.redirectToS3(w, r, key)
			}

			if p.checkConditionalHeaders(w, r, item) {
				return nil
			}

			if item.Content != nil {
				return p.serveCachedContent(w, r, item)
			}
		}
	}

	// 2. Handle S3 Redirection path (avoids downloading file body)
	if p.RedirectToS3 {
		headResult, err := p.s3Client.HeadObject(r.Context(), &s3.HeadObjectInput{
			Bucket: aws.String(p.Bucket),
			Key:    aws.String(key),
		})
		if err != nil {
			if p.isNotFoundError(err) {
				if p.cacheTTL > 0 && p.cache != nil {
					p.cache.Set(key, &CacheItem{Key: key, Exists: false}, 1*time.Minute)
				}
			}
			return err
		}

		if p.cacheTTL > 0 && p.cache != nil {
			etag := ""
			if headResult.ETag != nil {
				etag = *headResult.ETag
			}
			lastModified := time.Now()
			if headResult.LastModified != nil {
				lastModified = *headResult.LastModified
			}
			contentType := "application/octet-stream"
			if headResult.ContentType != nil && *headResult.ContentType != "" {
				contentType = *headResult.ContentType
			}
			p.cache.Set(key, &CacheItem{
				Key:          key,
				ETag:         etag,
				LastModified: lastModified,
				Size:         *headResult.ContentLength,
				ContentType:  contentType,
				Exists:       true,
			}, p.cacheTTL)
		}

		return p.redirectToS3(w, r, key)
	}

	// 3. Normal streaming / proxy path
	input := &s3.GetObjectInput{
		Bucket: aws.String(p.Bucket),
		Key:    aws.String(key),
	}

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		input.Range = aws.String(rangeHeader)
	}

	if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch != "" {
		input.IfNoneMatch = aws.String(ifNoneMatch)
	}
	if ifModifiedSince := r.Header.Get("If-Modified-Since"); ifModifiedSince != "" {
		if t, err := http.ParseTime(ifModifiedSince); err == nil {
			input.IfModifiedSince = &t
		}
	}

	result, err := p.s3Client.GetObject(r.Context(), input)
	if err != nil {
		if p.isNotModifiedError(err) {
			if p.cacheTTL > 0 && p.cache != nil {
				if item, ok := p.cache.Get(key); ok {
					p.cache.Set(key, item, p.cacheTTL)
				}
			}
			w.WriteHeader(http.StatusNotModified)
			return nil
		}

		if p.isNotFoundError(err) {
			if p.cacheTTL > 0 && p.cache != nil {
				p.cache.Set(key, &CacheItem{
					Key:    key,
					Exists: false,
				}, 1*time.Minute)
			}
		}
		return err
	}
	defer result.Body.Close()

	etag := ""
	if result.ETag != nil {
		etag = *result.ETag
	}
	lastModified := time.Now()
	if result.LastModified != nil {
		lastModified = *result.LastModified
	}

	contentType := "application/octet-stream"
	if result.ContentType != nil && *result.ContentType != "" {
		contentType = *result.ContentType
	} else {
		contentType = mime.TypeByExtension(filepath.Ext(key))
		if contentType == "" {
			contentType = "application/octet-stream"
		}
	}

	isRangeResponse := result.ContentRange != nil && *result.ContentRange != ""
	size := int64(0)
	if result.ContentLength != nil {
		size = *result.ContentLength
	}

	if etag != "" {
		w.Header().Set("ETag", etag)
	}
	w.Header().Set("Last-Modified", lastModified.UTC().Format(http.TimeFormat))
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Accept-Ranges", "bytes")

	if isRangeResponse {
		w.Header().Set("Content-Range", *result.ContentRange)
		w.WriteHeader(http.StatusPartialContent)
	} else {
		w.Header().Set("Content-Length", fmt.Sprintf("%d", size))
		w.WriteHeader(http.StatusOK)
	}

	canCacheContent := p.cacheTTL > 0 && p.maxCacheSize > 0 && size <= p.maxCacheSize && !isRangeResponse

	if canCacheContent {
		data, readErr := io.ReadAll(result.Body)
		if readErr != nil {
			return readErr
		}

		item := &CacheItem{
			Key:          key,
			ETag:         etag,
			LastModified: lastModified,
			Size:         size,
			ContentType:  contentType,
			Content:      data,
			Exists:       true,
		}
		p.cache.Set(key, item, p.cacheTTL)

		_, writeErr := w.Write(data)
		return writeErr
	}

	if p.cacheTTL > 0 && !isRangeResponse {
		p.cache.Set(key, &CacheItem{
			Key:          key,
			ETag:         etag,
			LastModified: lastModified,
			Size:         size,
			ContentType:  contentType,
			Exists:       true,
		}, p.cacheTTL)
	}

	_, writeErr := io.Copy(w, result.Body)
	return writeErr
}

// redirectToS3 redirects the client to the S3 URL (optionally pre-signed).
func (p *StaticPlugin) redirectToS3(w http.ResponseWriter, r *http.Request, key string) error {
	var redirectURL string

	if p.PresignRedirect && p.s3PresignClient != nil {
		presignedReq, err := p.s3PresignClient.PresignGetObject(r.Context(), &s3.GetObjectInput{
			Bucket: aws.String(p.Bucket),
			Key:    aws.String(key),
		}, func(opts *s3.PresignOptions) {
			opts.Expires = p.presignLifetime
		})
		if err != nil {
			return fmt.Errorf("failed to presign s3 redirect URL: %w", err)
		}
		redirectURL = presignedReq.URL
	} else {
		if p.Endpoint != "" {
			if p.UsePathStyle != nil && *p.UsePathStyle {
				redirectURL = fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(p.Endpoint, "/"), p.Bucket, key)
			} else {
				u, err := url.Parse(p.Endpoint)
				if err == nil {
					redirectURL = fmt.Sprintf("%s://%s.%s/%s", u.Scheme, p.Bucket, u.Host, key)
				} else {
					redirectURL = fmt.Sprintf("%s/%s/%s", strings.TrimSuffix(p.Endpoint, "/"), p.Bucket, key)
				}
			}
		} else {
			redirectURL = fmt.Sprintf("https://%s.s3.%s.amazonaws.com/%s", p.Bucket, p.Region, key)
		}
	}

	http.Redirect(w, r, redirectURL, http.StatusTemporaryRedirect)
	return nil
}

// checkConditionalHeaders checks client headers against cached item. Returns true if 304 served.
func (p *StaticPlugin) checkConditionalHeaders(w http.ResponseWriter, r *http.Request, item *CacheItem) bool {
	if ifNoneMatch := r.Header.Get("If-None-Match"); ifNoneMatch != "" {
		if ifNoneMatch == "*" || strings.Contains(ifNoneMatch, item.ETag) {
			w.Header().Set("ETag", item.ETag)
			w.WriteHeader(http.StatusNotModified)
			return true
		}
	}

	if ifModifiedSince := r.Header.Get("If-Modified-Since"); ifModifiedSince != "" {
		if t, err := http.ParseTime(ifModifiedSince); err == nil {
			if item.LastModified.Truncate(time.Second).Before(t.Add(1 * time.Second)) {
				w.Header().Set("Last-Modified", item.LastModified.UTC().Format(http.TimeFormat))
				w.WriteHeader(http.StatusNotModified)
				return true
			}
		}
	}

	return false
}

// serveCachedContent serves cached file content with full Range support using bytes.Reader.
func (p *StaticPlugin) serveCachedContent(w http.ResponseWriter, r *http.Request, item *CacheItem) error {
	w.Header().Set("ETag", item.ETag)
	w.Header().Set("Last-Modified", item.LastModified.UTC().Format(http.TimeFormat))
	w.Header().Set("Content-Type", item.ContentType)
	w.Header().Set("Accept-Ranges", "bytes")
	if item.ContentEncoding != "" {
		w.Header().Set("Content-Encoding", item.ContentEncoding)
		w.Header().Set("Vary", "Accept-Encoding")
	}
	if item.FilePath != "" {
		w.Header().Set("Cache-Control", cacheControlForPath(item.FilePath))
	}

	if rangeHeader := r.Header.Get("Range"); rangeHeader != "" {
		reader := bytes.NewReader(item.Content)
		http.ServeContent(w, r, item.Key, item.LastModified, reader)
		return nil
	}

	w.Header().Set("Content-Length", fmt.Sprintf("%d", item.Size))
	w.WriteHeader(http.StatusOK)
	_, err := w.Write(item.Content)
	return err
}

// isNotFoundError returns true if the error represents a missing object in S3.
func (p *StaticPlugin) isNotFoundError(err error) bool {
	if err == nil {
		return false
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code := apiErr.ErrorCode()
		return code == "NoSuchKey" || code == "NotFound" || code == "404"
	}
	errStr := err.Error()
	return strings.Contains(errStr, "NoSuchKey") || strings.Contains(errStr, "404") || strings.Contains(errStr, "StatusCode: 404")
}

// isNotModifiedError returns true if the error is 304 Not Modified from S3.
func (p *StaticPlugin) isNotModifiedError(err error) bool {
	if err == nil {
		return false
	}
	var apiErr smithy.APIError
	if errors.As(err, &apiErr) {
		code := apiErr.ErrorCode()
		return code == "NotModified" || code == "304"
	}
	errStr := err.Error()
	return strings.Contains(errStr, "304") || strings.Contains(errStr, "NotModified") || strings.Contains(errStr, "StatusCode: 304")
}

// isExcludedFromFallback checks if the file extension should skip fallback routing.
func (p *StaticPlugin) isExcludedFromFallback(path string) bool {
	ext := filepath.Ext(path)
	if ext == "" {
		return false
	}
	for _, excluded := range p.FallbackExcept {
		cleanEx := strings.TrimPrefix(excluded, ".")
		cleanExt := strings.TrimPrefix(ext, ".")
		if strings.EqualFold(cleanExt, cleanEx) {
			return true
		}
	}
	return false
}

func hasExtension(path string) bool {
	return filepath.Ext(path) != ""
}

// blobObjectKey builds the MinIO/S3 key for a content-addressed blob.
func blobObjectKey(hash string) string {
	return "blobs/" + hash
}

// pathCandidates returns lookup paths for a request URL path.
// /about → ["about/index.html", "about.html", "about"]
func pathCandidates(urlPath string) []string {
	clean := strings.Trim(urlPath, "/")
	if clean == "" {
		return []string{"index.html"}
	}
	if hasExtension(clean) {
		return []string{clean}
	}
	return []string{clean + "/index.html", clean + ".html", clean}
}

// requestEncodingKey returns the LRU encoding dimension for a request.
func requestEncodingKey(r *http.Request, urlPath string) string {
	clean := strings.Trim(urlPath, "/")
	if clean != "" && isImagePath(clean) && acceptsWebP(r.Header.Get("Accept")) {
		return "webp"
	}
	ae := r.Header.Get("Accept-Encoding")
	if acceptsToken(ae, "br") {
		return "br"
	}
	if acceptsToken(ae, "gzip") {
		return "gz"
	}
	return "raw"
}

func isImagePath(path string) bool {
	ext := strings.ToLower(filepath.Ext(stripCompressionSuffix(path)))
	switch ext {
	case ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".tif":
		return true
	default:
		return false
	}
}

func acceptsWebP(accept string) bool {
	return acceptsToken(accept, "image/webp")
}

// acceptsToken reports whether a comma-separated header list includes token
// (case-insensitive, ignores q-values and parameters).
func acceptsToken(header, token string) bool {
	token = strings.ToLower(token)
	for _, part := range strings.Split(header, ",") {
		part = strings.TrimSpace(part)
		if i := strings.IndexByte(part, ';'); i >= 0 {
			part = part[:i]
		}
		part = strings.TrimSpace(strings.ToLower(part))
		if part == token {
			return true
		}
	}
	return false
}

func stripCompressionSuffix(path string) string {
	if strings.HasSuffix(path, ".br") {
		return strings.TrimSuffix(path, ".br")
	}
	if strings.HasSuffix(path, ".gz") {
		return strings.TrimSuffix(path, ".gz")
	}
	return path
}

// contentTypeForPath infers MIME type from the original file path.
// Compression suffixes (.br / .gz) are stripped before lookup; blob keys are never used.
func contentTypeForPath(path string) string {
	ct := mime.TypeByExtension(filepath.Ext(stripCompressionSuffix(path)))
	if ct == "" {
		return "application/octet-stream"
	}
	return ct
}

// cacheControlForPath returns browser Cache-Control based on the original file extension.
func cacheControlForPath(path string) string {
	ext := strings.ToLower(filepath.Ext(stripCompressionSuffix(path)))
	switch ext {
	case ".html", ".htm":
		return "no-cache"
	case ".js", ".css", ".woff", ".woff2":
		return "max-age=31536000, immutable"
	case ".webp", ".png", ".jpg", ".jpeg", ".gif", ".svg":
		return "max-age=604800"
	default:
		return "max-age=3600"
	}
}
