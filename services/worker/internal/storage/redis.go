package storage

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"time"
)

// RedisCache is a minimal Upstash REST client used only to drop cached routing
// state for a deleted project.
//
// PostgreSQL is authoritative and the blob-server repairs a missing key from
// Postgres on the next miss, so every method here is best-effort: a Redis
// failure must never fail a cleanup job. The worker shares the console's and
// blob-server's key contract and namespace (REDIS_KEY_PREFIX):
//
//	site:subdomain:<subdomain>  → site_id
//	site:<site_id>:active       → active deployment id
//	manifest:<deployment_id>    → cached manifest JSON
//	site_version:<site_id>      → cache-busting counter
type RedisCache struct {
	baseURL string
	token   string
	prefix  string
	http    *http.Client
}

// NewRedisCache builds an Upstash REST client. prefix is the REDIS_KEY_PREFIX
// namespace (e.g. "px").
func NewRedisCache(baseURL, token, prefix string) *RedisCache {
	return &RedisCache{
		baseURL: strings.TrimSuffix(baseURL, "/"),
		token:   token,
		prefix:  prefix,
		http:    &http.Client{Timeout: 5 * time.Second},
	}
}

// Key applies the shared namespace.
func (r *RedisCache) Key(key string) string {
	if r == nil || r.prefix == "" {
		return key
	}
	return r.prefix + key
}

// Del removes already-namespaced keys. Errors are returned for logging only;
// callers must ignore them.
func (r *RedisCache) Del(ctx context.Context, namespacedKeys ...string) error {
	if r == nil || len(namespacedKeys) == 0 {
		return nil
	}

	// Upstash REST accepts a pipeline of commands as a JSON array.
	commands := make([][]any, 0, len(namespacedKeys))
	for _, k := range namespacedKeys {
		commands = append(commands, []any{"DEL", k})
	}
	return r.do(ctx, commands, nil)
}

// DelKeys removes logical (un-namespaced) keys.
func (r *RedisCache) DelKeys(ctx context.Context, keys ...string) error {
	if r == nil || len(keys) == 0 {
		return nil
	}
	namespaced := make([]string, 0, len(keys))
	for _, k := range keys {
		namespaced = append(namespaced, r.Key(k))
	}
	return r.Del(ctx, namespaced...)
}

// DelPattern removes every key matching a glob pattern via SCAN + DEL, looping
// until the cursor wraps. The pattern is namespaced first, so callers pass a
// logical pattern such as "manifest:*".
func (r *RedisCache) DelPattern(ctx context.Context, pattern string) error {
	if r == nil || pattern == "" {
		return nil
	}

	matched := r.Key(pattern)
	cursor := "0"

	for {
		var result []json.RawMessage
		if err := r.do(ctx, []any{"SCAN", cursor, "MATCH", matched, "COUNT", "200"}, &result); err != nil {
			return err
		}
		if len(result) < 2 {
			return nil
		}

		var nextCursor string
		if err := json.Unmarshal(result[0], &nextCursor); err != nil {
			return fmt.Errorf("decode scan cursor: %w", err)
		}
		var keys []string
		if err := json.Unmarshal(result[1], &keys); err != nil {
			return fmt.Errorf("decode scan keys: %w", err)
		}

		if len(keys) > 0 {
			if err := r.Del(ctx, keys...); err != nil {
				return err
			}
		}

		if nextCursor == "0" || nextCursor == "" {
			return nil
		}
		cursor = nextCursor
	}
}

func (r *RedisCache) do(ctx context.Context, command any, out any) error {
	body, err := json.Marshal(command)
	if err != nil {
		return fmt.Errorf("marshal redis command: %w", err)
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, r.baseURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("build redis request: %w", err)
	}
	req.Header.Set("content-type", "application/json")
	req.Header.Set("authorization", "Bearer "+r.token)

	res, err := r.http.Do(req)
	if err != nil {
		return fmt.Errorf("redis: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode > 299 {
		return fmt.Errorf("redis: unexpected status %d", res.StatusCode)
	}

	var envelope struct {
		Result json.RawMessage `json:"result"`
		Error  string          `json:"error"`
	}
	if err := json.NewDecoder(res.Body).Decode(&envelope); err != nil {
		return fmt.Errorf("decode redis response: %w", err)
	}
	if envelope.Error != "" {
		return fmt.Errorf("redis: %s", envelope.Error)
	}
	if out == nil || len(envelope.Result) == 0 {
		return nil
	}
	return json.Unmarshal(envelope.Result, out)
}
