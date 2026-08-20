package cdx_s3

import (
	"sync"
	"time"
)

// manifestCacheEntry holds a validated deployment manifest in the L1 LRU.
// Manifests are immutable and keyed by deployment ID, so storing the parsed
// object avoids re-parsing JSON on every hot-path L1 hit.
type manifestCacheEntry struct {
	key       string
	manifest  *DeploymentManifest
	expiredAt time.Time
}

// ManifestLRUCache is a process-local LRU for deployment manifests.
type ManifestLRUCache struct {
	mu       sync.Mutex
	capacity int
	items    map[string]*manifestCacheEntry
	order    []string
}

func NewManifestLRUCache(capacity int) *ManifestLRUCache {
	if capacity <= 0 {
		capacity = 256
	}
	return &ManifestLRUCache{
		capacity: capacity,
		items:    make(map[string]*manifestCacheEntry),
		order:    make([]string, 0, capacity),
	}
}

func (c *ManifestLRUCache) Get(key string) (*DeploymentManifest, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	entry, ok := c.items[key]
	if !ok {
		return nil, false
	}
	if time.Now().After(entry.expiredAt) {
		delete(c.items, key)
		c.removeFromOrder(key)
		return nil, false
	}

	c.touch(key)
	return entry.manifest, true
}

func (c *ManifestLRUCache) Set(key string, manifest *DeploymentManifest, ttl time.Duration) {
	if ttl <= 0 || manifest == nil {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	if _, ok := c.items[key]; ok {
		c.removeFromOrder(key)
	}

	for len(c.order) >= c.capacity {
		oldest := c.order[0]
		c.order = c.order[1:]
		delete(c.items, oldest)
	}

	c.items[key] = &manifestCacheEntry{
		key:       key,
		manifest:  manifest,
		expiredAt: time.Now().Add(ttl),
	}
	c.order = append(c.order, key)
}

func (c *ManifestLRUCache) touch(key string) {
	c.removeFromOrder(key)
	c.order = append(c.order, key)
}

func (c *ManifestLRUCache) removeFromOrder(key string) {
	for i, k := range c.order {
		if k == key {
			c.order = append(c.order[:i], c.order[i+1:]...)
			return
		}
	}
}

func (c *ManifestLRUCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.items, key)
	c.removeFromOrder(key)
}
