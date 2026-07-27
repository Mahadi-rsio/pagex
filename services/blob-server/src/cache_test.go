package cdx_s3

import (
	"testing"
	"time"
)

func TestLRUCache_Basic(t *testing.T) {
	c := NewLRUCache(2, 0)

	// Get missing key
	if _, ok := c.Get("foo"); ok {
		t.Fatal("expected miss for missing key")
	}

	now := time.Now()
	item1 := &CacheItem{
		Key:          "foo",
		ETag:         "etag-1",
		LastModified: now,
		Size:         100,
		ContentType:  "text/plain",
		Exists:       true,
	}

	// Set and Get
	c.Set("foo", item1, 1*time.Minute)
	got, ok := c.Get("foo")
	if !ok {
		t.Fatal("expected hit")
	}
	if got.ETag != "etag-1" || got.Size != 100 {
		t.Errorf("unexpected item retrieved: %+v", got)
	}

	// Update existing key
	item1Update := &CacheItem{
		Key:          "foo",
		ETag:         "etag-1-updated",
		LastModified: now,
		Size:         200,
		ContentType:  "text/plain",
		Exists:       true,
	}
	c.Set("foo", item1Update, 1*time.Minute)
	got, ok = c.Get("foo")
	if !ok || got.ETag != "etag-1-updated" || got.Size != 200 {
		t.Errorf("unexpected updated item: %+v", got)
	}
}

func TestLRUCache_Expiration(t *testing.T) {
	c := NewLRUCache(2, 0)
	item := &CacheItem{
		Key:    "expire-me",
		Exists: true,
	}

	c.Set("expire-me", item, 10*time.Millisecond)

	// Immediate get
	if _, ok := c.Get("expire-me"); !ok {
		t.Fatal("expected hit before expiration")
	}

	// Wait for expiration
	time.Sleep(15 * time.Millisecond)

	if _, ok := c.Get("expire-me"); ok {
		t.Fatal("expected miss after expiration")
	}
}

func TestLRUCache_Eviction(t *testing.T) {
	c := NewLRUCache(2, 0)

	c.Set("k1", &CacheItem{Key: "k1", Exists: true}, 1*time.Minute)
	c.Set("k2", &CacheItem{Key: "k2", Exists: true}, 1*time.Minute)

	// Access k1 to make k2 the LRU item
	if _, ok := c.Get("k1"); !ok {
		t.Fatal("expected hit for k1")
	}

	// Add k3, which should evict k2 (LRU)
	c.Set("k3", &CacheItem{Key: "k3", Exists: true}, 1*time.Minute)

	if _, ok := c.Get("k2"); ok {
		t.Fatal("expected k2 to be evicted")
	}
	if _, ok := c.Get("k1"); !ok {
		t.Fatal("expected k1 to be retained")
	}
	if _, ok := c.Get("k3"); !ok {
		t.Fatal("expected k3 to be retained")
	}
}

func TestLRUCache_Delete(t *testing.T) {
	c := NewLRUCache(5, 0)

	c.Set("tenant-a:__version__", &CacheItem{Key: "tenant-a:__version__", Exists: true}, 1*time.Minute)
	c.Set("tenant-a:8:/about:br", &CacheItem{Key: "tenant-a:8:/about:br", Exists: true}, 1*time.Minute)

	c.Delete("tenant-a:__version__")
	if _, ok := c.Get("tenant-a:__version__"); ok {
		t.Fatal("expected version key to be deleted")
	}
	if _, ok := c.Get("tenant-a:8:/about:br"); !ok {
		t.Fatal("expected unrelated key to be retained")
	}
}
