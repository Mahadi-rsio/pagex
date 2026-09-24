package cdx_s3

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// blobLoading coalesces concurrent full-object fetches for the same cache key
// so a thundering herd does not open N identical S3 GetObject calls.
var blobLoading sync.Map // bodyKey → *blobLoadGroup

type blobLoadGroup struct {
	done chan struct{}

	item *CacheItem // populated when the object was small enough to cache
	err  error

	// stream is non-nil only for the leader when the object is too large to
	// cache. Followers must open their own S3 GetObject.
	stream *s3.GetObjectOutput
}

// coalesceBlobFetch runs fetch once per key. Concurrent waiters share a
// successful cached item. When the object is too large to cache, only the
// leader receives the live S3 stream; followers get (nil, nil, nil) and should
// fetch independently.
func coalesceBlobFetch(key string, fetch func() (*CacheItem, *s3.GetObjectOutput, error)) (*CacheItem, *s3.GetObjectOutput, error) {
	fresh := &blobLoadGroup{done: make(chan struct{})}
	actual, loaded := blobLoading.LoadOrStore(key, fresh)
	group := actual.(*blobLoadGroup)

	if !loaded {
		item, stream, err := fetch()
		group.item = item
		group.stream = stream
		group.err = err
		close(group.done)
		blobLoading.Delete(key)
		return item, stream, err
	}

	<-group.done
	if group.err != nil {
		return nil, nil, group.err
	}
	if group.item != nil {
		return group.item, nil, nil
	}
	// Leader is streaming an uncacheable body — followers fetch separately.
	return nil, nil, nil
}

// fetchAndMaybeCacheBlob downloads blobs/{hash} (full object, no Range) and
// caches the body when it fits in the configured byte budget. Returns either
// a cacheable CacheItem or a live S3 stream for the caller to copy.
func (p *StaticPlugin) fetchAndMaybeCacheBlob(
	ctx context.Context,
	bodyKey, blobHash, contentType, contentEncoding, filePath string,
) (*CacheItem, *s3.GetObjectOutput, error) {
	if p.s3Client == nil {
		return nil, nil, fmt.Errorf("static_s3: S3 client not configured")
	}

	s3Key := blobObjectKey(blobHash)
	// Use the request context only — ResponseHeaderTimeout on the HTTP client
	// bounds time-to-first-byte. A shorter WithTimeout here would cancel the
	// body mid-stream when we return a live S3 reader to the leader.
	result, err := p.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.Bucket),
		Key:    aws.String(s3Key),
	})
	if err != nil {
		return nil, nil, err
	}

	etag := ""
	if result.ETag != nil {
		etag = *result.ETag
	}
	lastModified := time.Now()
	if result.LastModified != nil {
		lastModified = *result.LastModified
	}
	size := int64(0)
	if result.ContentLength != nil {
		size = *result.ContentLength
	}

	canCacheContent := p.cacheTTL > 0 && p.cache != nil && p.maxCacheSize > 0 && size > 0 && size <= p.maxCacheSize
	if canCacheContent {
		defer result.Body.Close()
		data, readErr := io.ReadAll(io.LimitReader(result.Body, p.maxCacheSize+1))
		if readErr != nil {
			return nil, nil, readErr
		}
		if int64(len(data)) > p.maxCacheSize {
			// Size header lied or object grew — do not retain in memory.
			item := &CacheItem{
				Key:             bodyKey,
				BlobHash:        blobHash,
				ETag:            etag,
				LastModified:    lastModified,
				Size:            size,
				ContentType:     contentType,
				ContentEncoding: contentEncoding,
				FilePath:        filePath,
				Exists:          true,
			}
			if p.cacheTTL > 0 && p.cache != nil {
				p.cache.Set(bodyKey, item, p.cacheTTL)
			}
			return nil, nil, nil
		}
		item := &CacheItem{
			Key:             bodyKey,
			BlobHash:        blobHash,
			ETag:            etag,
			LastModified:    lastModified,
			Size:            int64(len(data)),
			ContentType:     contentType,
			ContentEncoding: contentEncoding,
			FilePath:        filePath,
			Content:         data,
			Exists:          true,
		}
		p.cache.Set(bodyKey, item, p.cacheTTL)
		return item, nil, nil
	}

	// Too large (or caching disabled): return the live stream to the leader.
	if p.cacheTTL > 0 && p.cache != nil {
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
	return nil, result, nil
}

// fetchAndMaybeCacheObject is the single-tenant equivalent of fetchAndMaybeCacheBlob.
func (p *StaticPlugin) fetchAndMaybeCacheObject(ctx context.Context, key, contentType string) (*CacheItem, *s3.GetObjectOutput, error) {
	if p.s3Client == nil {
		return nil, nil, fmt.Errorf("static_s3: S3 client not configured")
	}

	result, err := p.s3Client.GetObject(ctx, &s3.GetObjectInput{
		Bucket: aws.String(p.Bucket),
		Key:    aws.String(key),
	})
	if err != nil {
		return nil, nil, err
	}

	etag := ""
	if result.ETag != nil {
		etag = *result.ETag
	}
	lastModified := time.Now()
	if result.LastModified != nil {
		lastModified = *result.LastModified
	}
	size := int64(0)
	if result.ContentLength != nil {
		size = *result.ContentLength
	}
	if contentType == "" {
		contentType = "application/octet-stream"
		if result.ContentType != nil && *result.ContentType != "" {
			contentType = *result.ContentType
		}
	}

	canCacheContent := p.cacheTTL > 0 && p.cache != nil && p.maxCacheSize > 0 && size > 0 && size <= p.maxCacheSize
	if canCacheContent {
		defer result.Body.Close()
		data, readErr := io.ReadAll(io.LimitReader(result.Body, p.maxCacheSize+1))
		if readErr != nil {
			return nil, nil, readErr
		}
		if int64(len(data)) > p.maxCacheSize {
			if p.cacheTTL > 0 && p.cache != nil {
				p.cache.Set(key, &CacheItem{
					Key:          key,
					ETag:         etag,
					LastModified: lastModified,
					Size:         size,
					ContentType:  contentType,
					Exists:       true,
				}, p.cacheTTL)
			}
			return nil, nil, nil
		}
		item := &CacheItem{
			Key:          key,
			ETag:         etag,
			LastModified: lastModified,
			Size:         int64(len(data)),
			ContentType:  contentType,
			Content:      data,
			Exists:       true,
		}
		p.cache.Set(key, item, p.cacheTTL)
		return item, nil, nil
	}

	if p.cacheTTL > 0 && p.cache != nil {
		p.cache.Set(key, &CacheItem{
			Key:          key,
			ETag:         etag,
			LastModified: lastModified,
			Size:         size,
			ContentType:  contentType,
			Exists:       true,
		}, p.cacheTTL)
	}
	return nil, result, nil
}
