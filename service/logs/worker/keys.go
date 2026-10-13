package main

import (
	"strings"
	"time"
)

const defaultHostSuffix = ".cloudisy.top"

// normalizeHost lowercases host and returns it only when it belongs to the
// tenant suffix (for example ".cloudisy.top").
func normalizeHost(host, suffix string) (string, bool) {
	h := strings.ToLower(strings.TrimSpace(host))
	if h == "" {
		return "", false
	}
	if suffix == "" {
		suffix = defaultHostSuffix
	}
	if !strings.HasSuffix(h, strings.ToLower(suffix)) {
		return "", false
	}
	return h, true
}

// hourBucket truncates a timestamp to its UTC hour boundary.
func hourBucket(ts time.Time) time.Time {
	return ts.UTC().Truncate(time.Hour)
}

// isRawKey reports whether key lives under the configured source prefix.
func isRawKey(prefix, key string) bool {
	if prefix == "" {
		prefix = "raw/"
	}
	return strings.HasPrefix(key, prefix) && len(key) > len(prefix)
}

// normalizeCountry returns an upper-cased two-letter country code, or "" when
// the value is missing or not a plausible code.
func normalizeCountry(country string) string {
	c := strings.ToUpper(strings.TrimSpace(country))
	if len(c) != 2 {
		return ""
	}
	for _, r := range c {
		if r < 'A' || r > 'Z' {
			return ""
		}
	}
	return c
}

// isCacheHit reports whether a CacheCacheStatus value counts as served by the
// edge cache.
func isCacheHit(status string) bool {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "hit", "stream_hit":
		return true
	default:
		return false
	}
}
