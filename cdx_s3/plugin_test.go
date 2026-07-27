package cdx_s3

import (
	"net/http"
	"os"
	"reflect"
	"strings"
	"testing"

	"github.com/caddyserver/caddy/v2"
	"github.com/caddyserver/caddy/v2/caddyconfig/caddyfile"
)

func TestUnmarshalCaddyfile(t *testing.T) {
	tests := []struct {
		name          string
		input         string
		expected      StaticPlugin
		shouldErr     bool
	}{
		{
			name: "basic options",
			input: `static_s3 {
				bucket my-bucket
				endpoint http://minio:9000
				access_key my-access-key
				secret_key my-secret-key
				region us-west-2
			}`,
			expected: StaticPlugin{
				Bucket:    "my-bucket",
				Endpoint:  "http://minio:9000",
				AccessKey: "my-access-key",
				SecretKey: "my-secret-key",
				Region:    "us-west-2",
			},
			shouldErr: false,
		},
		{
			name: "advanced options",
			input: `static_s3 {
				bucket my-bucket
				use_path_style false
				prefix public/
				fallback entrypoint.html
				fallback_except png jpg js css
				cache_ttl 5m
				cache_size 500
				max_cache_size 1MB
			}`,
			expected: StaticPlugin{
				Bucket:         "my-bucket",
				UsePathStyle:   boolPtr(false),
				Prefix:         "public/",
				Fallback:       "entrypoint.html",
				FallbackExcept: []string{"png", "jpg", "js", "css"},
				CacheTTL:       "5m",
				CacheSize:      500,
				MaxCacheSize:   "1MB",
			},
			shouldErr: false,
		},
		{
			name: "redirect options",
			input: `static_s3 {
				bucket my-bucket
				redirect_to_s3 true
				presign_redirect true
				presign_lifetime 10m
			}`,
			expected: StaticPlugin{
				Bucket:             "my-bucket",
				RedirectToS3:       true,
				PresignRedirect:    true,
				PresignLifetimeStr: "10m",
			},
			shouldErr: false,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			d := caddyfile.NewTestDispenser(tt.input)
			var p StaticPlugin
			err := p.UnmarshalCaddyfile(d)
			if (err != nil) != tt.shouldErr {
				t.Fatalf("expected error: %v, got: %v", tt.shouldErr, err)
			}
			if !tt.shouldErr {
				if p.Bucket != tt.expected.Bucket {
					t.Errorf("Bucket: expected %q, got %q", tt.expected.Bucket, p.Bucket)
				}
				if p.Endpoint != tt.expected.Endpoint {
					t.Errorf("Endpoint: expected %q, got %q", tt.expected.Endpoint, p.Endpoint)
				}
				if p.AccessKey != tt.expected.AccessKey {
					t.Errorf("AccessKey: expected %q, got %q", tt.expected.AccessKey, p.AccessKey)
				}
				if p.SecretKey != tt.expected.SecretKey {
					t.Errorf("SecretKey: expected %q, got %q", tt.expected.SecretKey, p.SecretKey)
				}
				if p.Region != tt.expected.Region {
					t.Errorf("Region: expected %q, got %q", tt.expected.Region, p.Region)
				}
				if (p.UsePathStyle == nil) != (tt.expected.UsePathStyle == nil) || (p.UsePathStyle != nil && *p.UsePathStyle != *tt.expected.UsePathStyle) {
					t.Errorf("UsePathStyle: expected %v, got %v", tt.expected.UsePathStyle, p.UsePathStyle)
				}
				if p.Prefix != tt.expected.Prefix {
					t.Errorf("Prefix: expected %q, got %q", tt.expected.Prefix, p.Prefix)
				}
				if p.Fallback != tt.expected.Fallback {
					t.Errorf("Fallback: expected %q, got %q", tt.expected.Fallback, p.Fallback)
				}
				if !reflect.DeepEqual(p.FallbackExcept, tt.expected.FallbackExcept) {
					t.Errorf("FallbackExcept: expected %v, got %v", tt.expected.FallbackExcept, p.FallbackExcept)
				}
				if p.CacheTTL != tt.expected.CacheTTL {
					t.Errorf("CacheTTL: expected %q, got %q", tt.expected.CacheTTL, p.CacheTTL)
				}
				if p.CacheSize != tt.expected.CacheSize {
					t.Errorf("CacheSize: expected %d, got %d", tt.expected.CacheSize, p.CacheSize)
				}
				if p.MaxCacheSize != tt.expected.MaxCacheSize {
					t.Errorf("MaxCacheSize: expected %q, got %q", tt.expected.MaxCacheSize, p.MaxCacheSize)
				}
				if p.RedirectToS3 != tt.expected.RedirectToS3 {
					t.Errorf("RedirectToS3: expected %v, got %v", tt.expected.RedirectToS3, p.RedirectToS3)
				}
				if p.PresignRedirect != tt.expected.PresignRedirect {
					t.Errorf("PresignRedirect: expected %v, got %v", tt.expected.PresignRedirect, p.PresignRedirect)
				}
				if p.PresignLifetimeStr != tt.expected.PresignLifetimeStr {
					t.Errorf("PresignLifetimeStr: expected %q, got %q", tt.expected.PresignLifetimeStr, p.PresignLifetimeStr)
				}
			}
		})
	}
}

func TestIsExcludedFromFallback(t *testing.T) {
	p := StaticPlugin{
		FallbackExcept: []string{"png", ".jpg", "js", "css"},
	}

	tests := []struct {
		path     string
		expected bool
	}{
		{"/index.html", false},
		{"/images/logo.png", true},
		{"/images/logo.PNG", true},
		{"/photo.jpg", true},
		{"/scripts/app.js", true},
		{"/styles.css", true},
		{"/data.json", false},
		{"/noextension", false},
	}

	for _, tt := range tests {
		got := p.isExcludedFromFallback(tt.path)
		if got != tt.expected {
			t.Errorf("isExcludedFromFallback(%q): expected %v, got %v", tt.path, tt.expected, got)
		}
	}
}

func TestHasExtension(t *testing.T) {
	tests := []struct {
		path     string
		expected bool
	}{
		{"/file.txt", true},
		{"/dir/file.png", true},
		{"/no-ext", false},
		{"/", false},
		{"/path/to/", false},
	}

	for _, tt := range tests {
		got := hasExtension(tt.path)
		if got != tt.expected {
			t.Errorf("hasExtension(%q): expected %v, got %v", tt.path, tt.expected, got)
		}
	}
}

func TestProvisionDefaults(t *testing.T) {
	// Set environment variables to avoid validation errors
	os.Setenv("S3_ACCESS_KEY", "env-access-key")
	os.Setenv("S3_SECRET_KEY", "env-secret-key")
	defer func() {
		os.Unsetenv("S3_ACCESS_KEY")
		os.Unsetenv("S3_SECRET_KEY")
	}()

	p := StaticPlugin{
		Bucket: "test-bucket",
	}

	// Just checking initialization of default variables
	// Since we mock context, it will try to call LoadDefaultConfig which parses env
	// We can catch any initial provision defaults setup before S3 Client is initialized.
	err := p.Provision(caddy.Context{})
	if err != nil {
		// Provision might fail if AWS LoadDefaultConfig checks validation or if it's run without context setup.
		// So we won't strictly fail the test if the external AWS config fails, but we'll print it.
		t.Logf("Provision returned error (expected in mock environment if network or specific context is required): %v", err)
	}

	if p.Fallback != "index.html" {
		t.Errorf("Fallback: expected default 'index.html', got %q", p.Fallback)
	}
	if p.Region != "us-east-1" {
		t.Errorf("Region: expected default 'us-east-1', got %q", p.Region)
	}
	if p.AccessKey != "env-access-key" {
		t.Errorf("AccessKey: expected 'env-access-key' from env, got %q", p.AccessKey)
	}
}

func TestBlobObjectKey(t *testing.T) {
	tests := []struct {
		hash     string
		expected string
	}{
		{"abc123", "blobs/abc123"},
		{"sha256deadbeef", "blobs/sha256deadbeef"},
	}
	for _, tt := range tests {
		got := blobObjectKey(tt.hash)
		if got != tt.expected {
			t.Errorf("blobObjectKey(%q): expected %q, got %q", tt.hash, tt.expected, got)
		}
	}
}

func TestPathCandidates(t *testing.T) {
	tests := []struct {
		path     string
		expected []string
	}{
		{"/", []string{"index.html"}},
		{"", []string{"index.html"}},
		{"/about", []string{"about/index.html", "about.html", "about"}},
		{"/about/", []string{"about/index.html", "about.html", "about"}},
		{"/assets/app.js", []string{"assets/app.js"}},
		{"/style.css", []string{"style.css"}},
	}
	for _, tt := range tests {
		got := pathCandidates(tt.path)
		if !reflect.DeepEqual(got, tt.expected) {
			t.Errorf("pathCandidates(%q): expected %v, got %v", tt.path, tt.expected, got)
		}
	}
}

func TestCacheControlForPath(t *testing.T) {
	tests := []struct {
		path     string
		expected string
	}{
		{"index.html", "no-cache"},
		{"about/index.html.br", "no-cache"},
		{"assets/app.js", "max-age=31536000, immutable"},
		{"assets/app.js.gz", "max-age=31536000, immutable"},
		{"styles.css", "max-age=31536000, immutable"},
		{"font.woff2", "max-age=31536000, immutable"},
		{"logo.png", "max-age=604800"},
		{"photo.jpg.webp", "max-age=604800"},
		{"data.json", "max-age=3600"},
	}
	for _, tt := range tests {
		got := cacheControlForPath(tt.path)
		if got != tt.expected {
			t.Errorf("cacheControlForPath(%q): expected %q, got %q", tt.path, tt.expected, got)
		}
	}
}

func TestContentTypeForPath(t *testing.T) {
	tests := []struct {
		path     string
		contains string // substring expected in content type
	}{
		{"index.html", "text/html"},
		{"index.html.br", "text/html"},
		{"app.js.gz", "javascript"},
		{"logo.png", "image/png"},
	}
	for _, tt := range tests {
		got := contentTypeForPath(tt.path)
		if !strings.Contains(got, tt.contains) {
			t.Errorf("contentTypeForPath(%q): expected to contain %q, got %q", tt.path, tt.contains, got)
		}
	}
}

func TestPickVariantMap(t *testing.T) {
	entries := map[string]string{
		"about/index.html":    "hash-raw",
		"about/index.html.br": "hash-br",
		"about/index.html.gz": "hash-gz",
		"logo.png":            "hash-png",
		"logo.png.webp":       "hash-webp",
	}

	res := pickVariantMap(entries, "about/index.html", "br, gzip", "")
	if res == nil || res.BlobHash != "hash-br" || res.ContentEncoding != "br" {
		t.Fatalf("expected br variant, got %+v", res)
	}

	res = pickVariantMap(entries, "about/index.html", "gzip", "")
	if res == nil || res.BlobHash != "hash-gz" || res.ContentEncoding != "gzip" {
		t.Fatalf("expected gzip variant, got %+v", res)
	}

	res = pickVariantMap(entries, "about/index.html", "", "")
	if res == nil || res.BlobHash != "hash-raw" || res.ContentEncoding != "" {
		t.Fatalf("expected raw variant, got %+v", res)
	}

	res = pickVariantMap(entries, "logo.png", "", "text/html, image/webp, */*")
	if res == nil || res.BlobHash != "hash-webp" {
		t.Fatalf("expected webp variant, got %+v", res)
	}

	res = pickVariantMap(entries, "missing.html", "br", "")
	if res != nil {
		t.Fatalf("expected nil for missing path, got %+v", res)
	}
}

func TestRequestEncodingKey(t *testing.T) {
	r := &http.Request{Header: http.Header{}}
	r.Header.Set("Accept-Encoding", "gzip, deflate, br")
	if got := requestEncodingKey(r, "/about"); got != "br" {
		t.Errorf("expected br, got %s", got)
	}

	r.Header.Set("Accept-Encoding", "gzip")
	if got := requestEncodingKey(r, "/about"); got != "gz" {
		t.Errorf("expected gz, got %s", got)
	}

	r.Header.Del("Accept-Encoding")
	if got := requestEncodingKey(r, "/about"); got != "raw" {
		t.Errorf("expected raw, got %s", got)
	}

	r.Header.Set("Accept", "image/webp")
	if got := requestEncodingKey(r, "/logo.png"); got != "webp" {
		t.Errorf("expected webp, got %s", got)
	}
}

func boolPtr(b bool) *bool {
	return &b
}

