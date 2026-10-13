package main

import (
	"bytes"
	"compress/gzip"
	"encoding/base64"
	"os"
	"testing"
	"time"
)

func TestParseEdgeTimestamp(t *testing.T) {
	rfc, err := parseEdgeTimestamp([]byte(`"2026-10-13T10:07:01Z"`))
	if err != nil {
		t.Fatalf("rfc3339: %v", err)
	}
	if want := time.Date(2026, 10, 13, 10, 7, 1, 0, time.UTC); !rfc.Equal(want) {
		t.Fatalf("rfc3339 = %s, want %s", rfc, want)
	}

	numeric, err := parseEdgeTimestamp([]byte(`1700000000`))
	if err != nil {
		t.Fatalf("numeric: %v", err)
	}
	if want := time.Unix(1700000000, 0).UTC(); !numeric.Equal(want) {
		t.Fatalf("numeric = %s, want %s", numeric, want)
	}

	quoted, err := parseEdgeTimestamp([]byte(`"1700000000.5"`))
	if err != nil {
		t.Fatalf("quoted numeric: %v", err)
	}
	if want := time.Unix(1700000000, 500000000).UTC(); !quoted.Equal(want) {
		t.Fatalf("quoted numeric = %s, want %s", quoted, want)
	}

	if _, err := parseEdgeTimestamp([]byte(`null`)); err == nil {
		t.Fatal("expected error for null timestamp")
	}
}

func TestNormalizeHost(t *testing.T) {
	if h, ok := normalizeHost("Foo.Cloudisy.Top", ".cloudisy.top"); !ok || h != "foo.cloudisy.top" {
		t.Fatalf("normalizeHost = %q, %v", h, ok)
	}
	if _, ok := normalizeHost("evil.example.com", ".cloudisy.top"); ok {
		t.Fatal("expected non-tenant host to be rejected")
	}
	if _, ok := normalizeHost("", ".cloudisy.top"); ok {
		t.Fatal("expected empty host to be rejected")
	}
}

func TestNormalizeCountryAndCacheHit(t *testing.T) {
	if c := normalizeCountry("ca"); c != "CA" {
		t.Fatalf("normalizeCountry = %q, want CA", c)
	}
	if c := normalizeCountry("USA"); c != "" {
		t.Fatalf("normalizeCountry = %q, want empty", c)
	}
	for _, s := range []string{"hit", "HIT", "stream_hit"} {
		if !isCacheHit(s) {
			t.Fatalf("isCacheHit(%q) = false, want true", s)
		}
	}
	if isCacheHit("miss") {
		t.Fatal("isCacheHit(miss) = true, want false")
	}
}

func TestAggregateSampleFile(t *testing.T) {
	f, err := os.Open("testdata/sample.ndjson")
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()

	agg := newAggregation()
	if err := parseRecords(f, ".cloudisy.top", agg); err != nil {
		t.Fatal(err)
	}

	if agg.records != 5 {
		t.Fatalf("records = %d, want 5", agg.records)
	}
	if agg.skipped != 2 {
		t.Fatalf("skipped = %d, want 2", agg.skipped)
	}

	foo10 := agg.usage[usageKey{"foo.cloudisy.top", time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC)}]
	if foo10 == nil {
		t.Fatal("missing foo 10:00 aggregate")
	}
	if foo10.requests != 2 || foo10.bytes != 150 || foo10.s2xx != 1 || foo10.s3xx != 1 || foo10.cacheHits != 1 {
		t.Fatalf("foo 10:00 = %+v", foo10)
	}

	bar10 := agg.usage[usageKey{"bar.cloudisy.top", time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC)}]
	if bar10 == nil {
		t.Fatal("missing bar 10:00 aggregate")
	}
	if bar10.requests != 2 || bar10.bytes != 50 || bar10.s2xx != 1 || bar10.s5xx != 1 || bar10.cacheHits != 2 {
		t.Fatalf("bar 10:00 = %+v", bar10)
	}

	if got := agg.country[countryKey{"bar.cloudisy.top", time.Date(2026, 10, 13, 10, 0, 0, 0, time.UTC), "CA"}]; got != 2 {
		t.Fatalf("bar 10:00 CA = %d, want 2", got)
	}
	if got := agg.country[countryKey{"foo.cloudisy.top", time.Date(2026, 10, 13, 11, 0, 0, 0, time.UTC), "DE"}]; got != 1 {
		t.Fatalf("foo 11:00 DE = %d, want 1", got)
	}
}

func TestAggregateGzipFile(t *testing.T) {
	plain, err := os.ReadFile("testdata/sample.ndjson")
	if err != nil {
		t.Fatal(err)
	}

	var buf bytes.Buffer
	zw := gzip.NewWriter(&buf)
	if _, err := zw.Write(plain); err != nil {
		t.Fatal(err)
	}
	if err := zw.Close(); err != nil {
		t.Fatal(err)
	}

	gzr, err := gzip.NewReader(bytes.NewReader(buf.Bytes()))
	if err != nil {
		t.Fatal(err)
	}
	defer gzr.Close()

	agg := newAggregation()
	if err := parseRecords(gzr, ".cloudisy.top", agg); err != nil {
		t.Fatal(err)
	}
	if agg.records != 5 || agg.skipped != 2 {
		t.Fatalf("records=%d skipped=%d, want 5/2", agg.records, agg.skipped)
	}
}

func TestExtractObjectKey(t *testing.T) {
	event := `{"action":"PutObject","bucket":"logs-raw","object":{"key":"raw/20261013/abc.log","size":10}}`

	if got, err := extractObjectKey(event); err != nil || got != "raw/20261013/abc.log" {
		t.Fatalf("plain json: %q, %v", got, err)
	}

	encoded := base64.StdEncoding.EncodeToString([]byte(event))
	if got, err := extractObjectKey(encoded); err != nil || got != "raw/20261013/abc.log" {
		t.Fatalf("base64 json: %q, %v", got, err)
	}

	if got, err := extractObjectKey("raw/20261013/def.log"); err != nil || got != "raw/20261013/def.log" {
		t.Fatalf("plain key: %q, %v", got, err)
	}

	if _, err := extractObjectKey("nonsense"); err == nil {
		t.Fatal("expected error for unrecognized body")
	}
}
