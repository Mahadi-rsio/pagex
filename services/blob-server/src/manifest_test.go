package cdx_s3

import (
	"encoding/json"
	"sync"
	"testing"
)

func TestNormalizeManifestPath(t *testing.T) {
	tests := []struct {
		in   string
		want string
		ok   bool
	}{
		{"/index.html", "index.html", true},
		{"about/index.html", "about/index.html", true},
		{"../etc/passwd", "", false},
		{"foo//bar", "foo/bar", true},
		{"%2e%2e/secret", "", false},
		{"", "", false},
	}
	for _, tt := range tests {
		got, ok := normalizeManifestPath(tt.in)
		if ok != tt.ok || got != tt.want {
			t.Errorf("normalizeManifestPath(%q) = (%q, %v), want (%q, %v)", tt.in, got, ok, tt.want, tt.ok)
		}
	}
}

func TestValidateDeploymentManifest(t *testing.T) {
	valid := DeploymentManifest{
		Version:      manifestSchemaVersion,
		DeploymentID: "dep-1",
		Files: map[string]string{
			"index.html": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
		},
	}
	raw, _ := json.Marshal(valid)
	m, err := validateDeploymentManifest(raw, "dep-1")
	if err != nil || m.Files["index.html"] == "" {
		t.Fatalf("expected valid manifest, got err=%v m=%+v", err, m)
	}

	dup := DeploymentManifest{
		Version:      manifestSchemaVersion,
		DeploymentID: "dep-1",
		Files: map[string]string{
			"index.html": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
			"/index.html": "b665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
		},
	}
	dupRaw, _ := json.Marshal(dup)
	if _, err := validateDeploymentManifest(dupRaw, "dep-1"); err == nil {
		t.Fatal("expected duplicate path error")
	}

	traversal := DeploymentManifest{
		Version:      manifestSchemaVersion,
		DeploymentID: "dep-1",
		Files: map[string]string{
			"../secret": "a665a45920422f9d417e4867efdc4fb8a04a1f3fff1fa07e998e86f7f7a27ae3",
		},
	}
	trRaw, _ := json.Marshal(traversal)
	if _, err := validateDeploymentManifest(trRaw, "dep-1"); err == nil {
		t.Fatal("expected path traversal rejection")
	}
}

func TestManifestLRUCache(t *testing.T) {
	c := NewManifestLRUCache(2)
	dep := &DeploymentManifest{Version: 1, DeploymentID: "dep-1", Files: map[string]string{"index.html": "abc"}}
	c.Set("manifest:dep-1", dep, manifestRedisTTL)
	got, ok := c.Get("manifest:dep-1")
	if !ok || got == nil || got.DeploymentID != "dep-1" || got.Files["index.html"] != "abc" {
		t.Fatalf("expected manifest cache hit, got %+v (ok=%v)", got, ok)
	}
}

func TestManifestLoadGroupSingleFlight(t *testing.T) {
	manifestLoading.Delete("dep-flight")

	var loads int
	var mu sync.Mutex
	group := &manifestLoadGroup{done: make(chan struct{})}
	manifestLoading.Store("dep-flight", group)

	var start sync.WaitGroup
	start.Add(1)
	var wg sync.WaitGroup
	const n = 50

	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			start.Wait()
			groupVal, ok := manifestLoading.Load("dep-flight")
			if !ok {
				t.Error("missing load group")
				return
			}
			g := groupVal.(*manifestLoadGroup)
			g.once.Do(func() {
				mu.Lock()
				loads++
				mu.Unlock()
				g.manifest = &DeploymentManifest{DeploymentID: "dep-flight"}
				close(g.done)
			})
			<-g.done
		}()
	}
	start.Done()
	wg.Wait()

	mu.Lock()
	defer mu.Unlock()
	if loads != 1 {
		t.Fatalf("expected single-flight load count 1, got %d", loads)
	}
	manifestLoading.Delete("dep-flight")
}

func TestResolveBlobFromManifest(t *testing.T) {
	entries := map[string]string{
		"index.html":    "hash-raw",
		"index.html.br": "hash-br",
	}
	res := pickVariantMap(entries, "index.html", "br, gzip", "")
	if res == nil || res.BlobHash != "hash-br" {
		t.Fatalf("expected br variant from manifest map, got %+v", res)
	}
}

func TestManifestObjectKey(t *testing.T) {
	got := manifestObjectKey("dep-123")
	if got != "manifests/dep-123.manifest.json" {
		t.Fatalf("unexpected key: %s", got)
	}
}
