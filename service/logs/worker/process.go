package main

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"strconv"
	"strings"
	"time"
)

const maxLineBytes = 1 << 20

type logRecord struct {
	RayID               string          `json:"RayID"`
	EdgeStartTimestamp  json.RawMessage `json:"EdgeStartTimestamp"`
	ClientRequestHost   string          `json:"ClientRequestHost"`
	ClientRequestPath   string          `json:"ClientRequestPath"`
	ClientRequestMethod string          `json:"ClientRequestMethod"`
	EdgeResponseStatus  int             `json:"EdgeResponseStatus"`
	EdgeResponseBytes   int64           `json:"EdgeResponseBytes"`
	ClientCountry       string          `json:"ClientCountry"`
	CacheCacheStatus    string          `json:"CacheCacheStatus"`
}

type usageKey struct {
	host string
	hour time.Time
}

type countryKey struct {
	host    string
	hour    time.Time
	country string
}

type usageAgg struct {
	requests  int64
	bytes     int64
	s2xx      int64
	s3xx      int64
	s4xx      int64
	s5xx      int64
	cacheHits int64
}

type aggregation struct {
	usage   map[usageKey]*usageAgg
	country map[countryKey]int64
	records int64
	skipped int64
}

func newAggregation() *aggregation {
	return &aggregation{
		usage:   make(map[usageKey]*usageAgg),
		country: make(map[countryKey]int64),
	}
}

// parseRecords reads newline-delimited JSON log records from r and folds them
// into agg. Malformed lines are counted as skipped rather than failing the run.
func parseRecords(r io.Reader, suffix string, agg *aggregation) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 0, 64*1024), maxLineBytes)
	for sc.Scan() {
		line := bytes.TrimSpace(sc.Bytes())
		if len(line) == 0 {
			continue
		}
		var rec logRecord
		if err := json.Unmarshal(line, &rec); err != nil {
			agg.skipped++
			continue
		}
		accumulate(agg, rec, suffix)
	}
	return sc.Err()
}

func accumulate(agg *aggregation, rec logRecord, suffix string) {
	host, ok := normalizeHost(rec.ClientRequestHost, suffix)
	if !ok {
		agg.skipped++
		return
	}
	ts, err := parseEdgeTimestamp(rec.EdgeStartTimestamp)
	if err != nil {
		agg.skipped++
		return
	}

	hour := hourBucket(ts)
	uk := usageKey{host: host, hour: hour}
	u := agg.usage[uk]
	if u == nil {
		u = &usageAgg{}
		agg.usage[uk] = u
	}
	u.requests++
	u.bytes += rec.EdgeResponseBytes
	switch {
	case rec.EdgeResponseStatus >= 200 && rec.EdgeResponseStatus < 300:
		u.s2xx++
	case rec.EdgeResponseStatus >= 300 && rec.EdgeResponseStatus < 400:
		u.s3xx++
	case rec.EdgeResponseStatus >= 400 && rec.EdgeResponseStatus < 500:
		u.s4xx++
	case rec.EdgeResponseStatus >= 500 && rec.EdgeResponseStatus < 600:
		u.s5xx++
	}
	if isCacheHit(rec.CacheCacheStatus) {
		u.cacheHits++
	}

	agg.records++
	if c := normalizeCountry(rec.ClientCountry); c != "" {
		agg.country[countryKey{host: host, hour: hour, country: c}]++
	}
}

// parseEdgeTimestamp handles both the rfc3339 string form (what the Logpush job
// is configured to emit) and the raw unix-seconds numeric form.
func parseEdgeTimestamp(raw json.RawMessage) (time.Time, error) {
	s := strings.TrimSpace(string(raw))
	if s == "" || s == "null" {
		return time.Time{}, fmt.Errorf("empty EdgeStartTimestamp")
	}

	if s[0] == '"' {
		var str string
		if err := json.Unmarshal(raw, &str); err != nil {
			return time.Time{}, fmt.Errorf("unmarshal timestamp: %w", err)
		}
		if t, err := time.Parse(time.RFC3339Nano, str); err == nil {
			return t, nil
		}
		if f, err := strconv.ParseFloat(str, 64); err == nil {
			return unixToTime(f), nil
		}
		return time.Time{}, fmt.Errorf("unparseable timestamp %q", str)
	}

	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return time.Time{}, fmt.Errorf("unparseable timestamp %q", s)
	}
	return unixToTime(f), nil
}

func unixToTime(f float64) time.Time {
	sec := int64(f)
	ns := int64((f - float64(sec)) * 1e9)
	if ns < 0 {
		ns = 0
	}
	return time.Unix(sec, ns).UTC()
}
