package cdx_s3

import (
	"container/list"
	"sync"
	"time"
)

type CacheItem struct {
	Key             string
	ETag            string
	LastModified    time.Time
	Size            int64
	ContentType     string
	ContentEncoding string // "br", "gzip", or empty
	FilePath        string // original site path (for mime / Cache-Control)
	BlobHash        string // content-addressed blob SHA256
	Content         []byte // Nil if only metadata is cached
	ExpiredAt       time.Time
	Exists          bool // Negative caching support
}

type cacheEntry struct {
	key   string
	value *CacheItem
}

type LRUCache struct {
	mu          sync.Mutex // Exclusive Mutex is cleaner here
	capacity    int        // Max items limit
	maxByteSize int64      // Max total byte size allowed
	currentBytes int64      // Track current bytes in RAM
	items       map[string]*list.Element
	evictList   *list.List
}

func NewLRUCache(capacity int, maxByteSize int64) *LRUCache {
	if capacity <= 0 {
		capacity = 1000
	}
	return &LRUCache{
		capacity:    capacity,
		maxByteSize: maxByteSize,
		items:       make(map[string]*list.Element),
		evictList:   list.New(),
	}
}

func (c *LRUCache) Get(key string) (*CacheItem, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()

	elem, ok := c.items[key]
	if !ok {
		return nil, false
	}

	entry := elem.Value.(*cacheEntry)
	if time.Now().After(entry.value.ExpiredAt) {
		c.removeElement(elem)
		return nil, false
	}

	c.evictList.MoveToFront(elem)
	return entry.value, true
}

func (c *LRUCache) Set(key string, value *CacheItem, ttl time.Duration) {
	if ttl <= 0 {
		return
	}

	c.mu.Lock()
	defer c.mu.Unlock()

	value.ExpiredAt = time.Now().Add(ttl)
	itemSize := int64(len(value.Content))

	// If item already exists, remove old one first to adjust size
	if elem, ok := c.items[key]; ok {
		c.removeElement(elem)
	}

	// Evict oldest items if memory size or item capacity exceeds limit
	for (c.evictList.Len() >= c.capacity || (c.maxByteSize > 0 && c.currentBytes+itemSize > c.maxByteSize)) && c.evictList.Len() > 0 {
		c.evictOldest()
	}

	entry := &cacheEntry{key: key, value: value}
	elem := c.evictList.PushFront(entry)
	c.items[key] = elem
	c.currentBytes += itemSize
}

// Delete removes a single cache key if present.
func (c *LRUCache) Delete(key string) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if elem, ok := c.items[key]; ok {
		c.removeElement(elem)
	}
}

func (c *LRUCache) removeElement(elem *list.Element) {
	c.evictList.Remove(elem)
	entry := elem.Value.(*cacheEntry)
	delete(c.items, entry.key)
	c.currentBytes -= int64(len(entry.value.Content))
}

func (c *LRUCache) evictOldest() {
	elem := c.evictList.Back()
	if elem != nil {
		c.removeElement(elem)
	}
}
