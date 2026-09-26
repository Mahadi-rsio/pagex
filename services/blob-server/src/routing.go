package cdx_s3

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Tenant routing contract shared with the console. PostgreSQL is authoritative;
// Redis is the durable distributed lookup layer; the process-local LRU is L1.
//
//	site:subdomain:<subdomain>  → site_id               (no TTL; immutable)
//	site:<site_id>:active       → active_deployment_id  (1h safety TTL)
//
// These key names must stay byte-for-byte identical to the helpers in
// services/console/src/server/api/infrastructure/cache/routing.ts.
const (
	routingSubdomainKeyPrefix = "site:subdomain:"
	routingActiveKeySuffix    = ":active"

	// activeDeploymentRedisTTLSeconds mirrors the console writer's 1h TTL. When
	// it lapses the mapping is rebuilt from PostgreSQL on the next miss.
	activeDeploymentRedisTTLSeconds = 60 * 60

	// redisRequestTimeout bounds a single Upstash round-trip so a slow Redis
	// can never stall tenant requests; the lookup simply falls back to Postgres.
	redisRequestTimeout = 2 * time.Second
)

func subdomainRoutingKey(subdomain string) string {
	return routingSubdomainKeyPrefix + subdomain
}

func activeDeploymentRoutingKey(siteID string) string {
	return "site:" + siteID + routingActiveKeySuffix
}

// isUUID reports whether s is a canonical 8-4-4-4-12 hex UUID. Routing values
// are Postgres UUIDs written by the console; a malformed value (corruption or a
// foreign writer sharing the key prefix) must be treated as a miss so the
// authoritative PostgreSQL lookup can repair it, instead of surfacing a Postgres
// `invalid input syntax for type uuid` error as a 500.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i := 0; i < len(s); i++ {
		c := s[i]
		switch i {
		case 8, 13, 18, 23:
			if c != '-' {
				return false
			}
		default:
			if !isHexDigit(c) {
				return false
			}
		}
	}
	return true
}

func isHexDigit(c byte) bool {
	return (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
}

// routingKV is the durable distributed lookup layer (Upstash Redis over REST).
type routingKV interface {
	// Get returns (value, true, nil) on hit, ("", false, nil) on miss, and a
	// non-nil error on transport/decoding failure.
	Get(ctx context.Context, key string) (string, bool, error)
	// Set stores value with an optional TTL (0 = no expiry).
	Set(ctx context.Context, key, value string, ttlSeconds int) error
}

// resolutionStore is the authoritative control-plane lookup (PostgreSQL).
type resolutionStore interface {
	// SiteIDBySubdomain returns (siteID, true, nil) on hit and ("", false, nil)
	// when no active site owns the subdomain.
	SiteIDBySubdomain(ctx context.Context, subdomain string) (string, bool, error)
	// ActiveDeploymentBySite returns the active deployment for a site, or
	// ("", false, nil) when the site has none.
	ActiveDeploymentBySite(ctx context.Context, siteID string) (string, bool, error)
}

// postgresStore implements resolutionStore against the control-plane database.
type postgresStore struct {
	db *sql.DB
}

func (s postgresStore) SiteIDBySubdomain(ctx context.Context, subdomain string) (string, bool, error) {
	var siteID string
	err := s.db.QueryRowContext(ctx,
		"SELECT id FROM sites WHERE subdomain = $1 AND active = true LIMIT 1",
		subdomain,
	).Scan(&siteID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return siteID, true, nil
}

func (s postgresStore) ActiveDeploymentBySite(ctx context.Context, siteID string) (string, bool, error) {
	// Defense in depth: a non-UUID siteID would make Postgres reject the query
	// with a cast error. Resolve it to a clean miss instead.
	if !isUUID(siteID) {
		return "", false, nil
	}

	var deploymentID string
	err := s.db.QueryRowContext(ctx, `
		SELECT id FROM deployments
		WHERE site_id = $1 AND is_active = true AND manifest_key IS NOT NULL
		LIMIT 1
	`, siteID).Scan(&deploymentID)
	if errors.Is(err, sql.ErrNoRows) {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return deploymentID, true, nil
}

// upstashClient is a minimal Upstash REST client. Upstash speaks HTTP rather
// than the Redis wire protocol, so only the two commands the routing layer needs
// are implemented: GET and SET (with optional EX).
type upstashClient struct {
	baseURL string
	token   string
	prefix  string
	http    *http.Client
}

func newUpstashClient(baseURL, token, keyPrefix string) *upstashClient {
	if keyPrefix == "" {
		keyPrefix = "px"
	}
	return &upstashClient{
		baseURL: strings.TrimRight(baseURL, "/"),
		token:   token,
		prefix:  keyPrefix,
		http:    &http.Client{Timeout: redisRequestTimeout},
	}
}

func (c *upstashClient) namespaced(key string) string {
	return c.prefix + ":" + key
}

func (c *upstashClient) Get(ctx context.Context, key string) (string, bool, error) {
	body, err := c.do(ctx, "/get/"+url.PathEscape(c.namespaced(key)))
	if err != nil {
		return "", false, err
	}

	var resp struct {
		Result *string `json:"result"`
		Error  string  `json:"error"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return "", false, fmt.Errorf("upstash: decode response: %w", err)
	}
	if resp.Error != "" {
		return "", false, fmt.Errorf("upstash: %s", resp.Error)
	}
	if resp.Result == nil {
		return "", false, nil
	}
	return *resp.Result, true, nil
}

func (c *upstashClient) Set(ctx context.Context, key, value string, ttlSeconds int) error {
	endpoint := "/set/" + url.PathEscape(c.namespaced(key)) + "/" + url.PathEscape(value)
	if ttlSeconds > 0 {
		endpoint += "/ex/" + strconv.Itoa(ttlSeconds)
	}

	body, err := c.do(ctx, endpoint)
	if err != nil {
		return err
	}

	var resp struct {
		Result string `json:"result"`
		Error  string `json:"error"`
	}
	if err := json.Unmarshal(body, &resp); err != nil {
		return fmt.Errorf("upstash: decode response: %w", err)
	}
	if resp.Error != "" {
		return fmt.Errorf("upstash: %s", resp.Error)
	}
	return nil
}

func (c *upstashClient) do(ctx context.Context, path string) ([]byte, error) {
	reqCtx, cancel := context.WithTimeout(ctx, redisRequestTimeout)
	defer cancel()

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, c.baseURL+path, nil)
	if err != nil {
		return nil, fmt.Errorf("upstash: build request: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+c.token)

	resp, err := c.http.Do(req)
	if err != nil {
		return nil, fmt.Errorf("upstash: request failed: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("upstash: read response: %w", err)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, fmt.Errorf("upstash: http %d: %s", resp.StatusCode, strings.TrimSpace(string(body)))
	}
	return body, nil
}
