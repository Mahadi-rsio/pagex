package cdx_s3

import (
	"context"
	"errors"
	"testing"
	"time"
)

// Routing values are Postgres UUIDs in production, so the fixtures use valid
// UUIDs; `TestIsUUID` covers the malformed cases separately.
const (
	siteA = "11111111-1111-4111-8111-111111111111"
	siteB = "22222222-2222-4222-8222-222222222222"
	siteC = "33333333-3333-4333-8333-333333333333"
	siteD = "44444444-4444-4444-8444-444444444444"
	depA  = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
	depB  = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb"
	depC  = "cccccccc-cccc-4ccc-8ccc-cccccccccccc"
	depD  = "dddddddd-dddd-4ddd-8ddd-dddddddddddd"
	depE  = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee"
)

type kvSet struct {
	key     string
	value   string
	ttlSecs int
}

type fakeRoutingKV struct {
	values map[string]string
	getErr error
	setErr error
	gets   []string
	sets   []kvSet
}

func (f *fakeRoutingKV) Get(_ context.Context, key string) (string, bool, error) {
	f.gets = append(f.gets, key)
	if f.getErr != nil {
		return "", false, f.getErr
	}
	v, ok := f.values[key]
	if !ok {
		return "", false, nil
	}
	return v, true, nil
}

func (f *fakeRoutingKV) Set(_ context.Context, key, value string, ttlSeconds int) error {
	f.sets = append(f.sets, kvSet{key: key, value: value, ttlSecs: ttlSeconds})
	if f.setErr != nil {
		return f.setErr
	}
	if f.values == nil {
		f.values = map[string]string{}
	}
	f.values[key] = value
	return nil
}

type fakeStore struct {
	sites       map[string]string
	deployments map[string]string
	siteErr     error
	depErr      error
	siteCalls   int
	depCalls    int
}

func (f *fakeStore) SiteIDBySubdomain(_ context.Context, subdomain string) (string, bool, error) {
	f.siteCalls++
	if f.siteErr != nil {
		return "", false, f.siteErr
	}
	v, ok := f.sites[subdomain]
	return v, ok, nil
}

func (f *fakeStore) ActiveDeploymentBySite(_ context.Context, siteID string) (string, bool, error) {
	f.depCalls++
	if f.depErr != nil {
		return "", false, f.depErr
	}
	v, ok := f.deployments[siteID]
	return v, ok, nil
}

func newRoutingTestPlugin(kv routingKV, store resolutionStore) *StaticPlugin {
	return &StaticPlugin{
		cacheTTL: time.Minute,
		cache:    NewLRUCache(64, 1<<20),
		routing:  kv,
		store:    store,
	}
}

// ── Subdomain → site_id ─────────────────────────────────────────────────────

func TestResolveSiteIDRedisHitSkipsPostgres(t *testing.T) {
	kv := &fakeRoutingKV{values: map[string]string{subdomainRoutingKey("acme"): siteA}}
	store := &fakeStore{sites: map[string]string{"acme": siteA}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != siteA {
		t.Fatalf("expected site-1, got %q", got)
	}
	if store.siteCalls != 0 {
		t.Fatalf("PostgreSQL must not be queried on a Redis hit (calls=%d)", store.siteCalls)
	}

	// L1 is now warm: a repeated request must not touch Redis either.
	getsBefore := len(kv.gets)
	got2, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil || got2 != siteA {
		t.Fatalf("L1 re-resolution failed: got=%q err=%v", got2, err)
	}
	if len(kv.gets) != getsBefore {
		t.Fatalf("L1 hit must not re-query Redis (gets %d -> %d)", getsBefore, len(kv.gets))
	}
}

func TestResolveSiteIDRedisMissFallsBackToPostgresAndBackfills(t *testing.T) {
	kv := &fakeRoutingKV{}
	store := &fakeStore{sites: map[string]string{"acme": siteB}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != siteB {
		t.Fatalf("expected site-9, got %q", got)
	}
	if store.siteCalls != 1 {
		t.Fatalf("expected one PostgreSQL fallback, got %d", store.siteCalls)
	}
	if len(kv.sets) != 1 {
		t.Fatalf("expected Redis backfill, got %+v", kv.sets)
	}
	if kv.sets[0].key != subdomainRoutingKey("acme") || kv.sets[0].value != siteB {
		t.Fatalf("unexpected backfill: %+v", kv.sets[0])
	}
	if kv.sets[0].ttlSecs != 0 {
		t.Fatalf("subdomain mapping must not expire, got ttl=%d", kv.sets[0].ttlSecs)
	}
}

func TestResolveSiteIDRedisFailureFallsBackToPostgres(t *testing.T) {
	kv := &fakeRoutingKV{getErr: errors.New("redis down")}
	store := &fakeStore{sites: map[string]string{"acme": siteC}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil {
		t.Fatalf("Redis failure must not surface: %v", err)
	}
	if got != siteC {
		t.Fatalf("expected site-2, got %q", got)
	}
	if store.siteCalls != 1 {
		t.Fatalf("expected PostgreSQL fallback, got %d calls", store.siteCalls)
	}
}

func TestResolveSiteIDBackfillFailureStillSucceeds(t *testing.T) {
	kv := &fakeRoutingKV{setErr: errors.New("redis down")}
	store := &fakeStore{sites: map[string]string{"acme": siteD}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil || got != siteD {
		t.Fatalf("backfill failure must be non-fatal: got=%q err=%v", got, err)
	}
}

func TestResolveSiteIDPostgresMissIsNegativeCached(t *testing.T) {
	kv := &fakeRoutingKV{}
	store := &fakeStore{}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "ghost")
	if err != nil || got != "" {
		t.Fatalf("expected empty miss, got=%q err=%v", got, err)
	}
	if len(kv.sets) != 0 {
		t.Fatalf("a Postgres miss must not backfill Redis: %+v", kv.sets)
	}

	// Negative L1 hit: no second Postgres query.
	if _, _ = p.resolveSiteID(context.Background(), "ghost"); store.siteCalls != 1 {
		t.Fatalf("negative cache should absorb repeat lookups, got %d calls", store.siteCalls)
	}
}

// ── site_id → active deployment ─────────────────────────────────────────────

func TestResolveActiveDeploymentRedisHitSkipsPostgres(t *testing.T) {
	kv := &fakeRoutingKV{values: map[string]string{activeDeploymentRoutingKey(siteA): depD}}
	store := &fakeStore{deployments: map[string]string{siteA: depD}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveActiveDeploymentID(context.Background(), siteA)
	if err != nil || got != depD {
		t.Fatalf("expected dep-7, got=%q err=%v", got, err)
	}
	if store.depCalls != 0 {
		t.Fatalf("PostgreSQL must not be queried on a Redis hit (calls=%d)", store.depCalls)
	}
}

func TestResolveActiveDeploymentMissBackfillsWithSafetyTTL(t *testing.T) {
	kv := &fakeRoutingKV{}
	store := &fakeStore{deployments: map[string]string{siteA: depE}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveActiveDeploymentID(context.Background(), siteA)
	if err != nil || got != depE {
		t.Fatalf("expected dep-8, got=%q err=%v", got, err)
	}
	if len(kv.sets) != 1 {
		t.Fatalf("expected Redis backfill, got %+v", kv.sets)
	}
	set := kv.sets[0]
	if set.key != activeDeploymentRoutingKey(siteA) || set.value != depE {
		t.Fatalf("unexpected backfill: %+v", set)
	}
	if set.ttlSecs != activeDeploymentRedisTTLSeconds {
		t.Fatalf("active mapping must carry the 1h safety TTL, got %d", set.ttlSecs)
	}
}

func TestResolveActiveDeploymentRedisFailureFallsBackToPostgres(t *testing.T) {
	kv := &fakeRoutingKV{getErr: errors.New("redis down")}
	store := &fakeStore{deployments: map[string]string{siteA: depC}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveActiveDeploymentID(context.Background(), siteA)
	if err != nil || got != depC {
		t.Fatalf("Redis failure must fall back cleanly: got=%q err=%v", got, err)
	}
	if store.depCalls != 1 {
		t.Fatalf("expected PostgreSQL fallback, got %d calls", store.depCalls)
	}
}

// A deploy/rollback repoints site:<id>:active under the same site_id; the
// subdomain → site_id mapping is immutable and must never be touched.
func TestDeploymentChangeNeverTouchesSubdomainMapping(t *testing.T) {
	kv := &fakeRoutingKV{
		values: map[string]string{
			subdomainRoutingKey("acme"):       siteA,
			activeDeploymentRoutingKey(siteA): depA,
		},
	}
	store := &fakeStore{deployments: map[string]string{siteA: depB}}
	p := newRoutingTestPlugin(kv, store)

	siteBefore, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil || siteBefore != siteA {
		t.Fatalf("expected %s, got=%q err=%v", siteA, siteBefore, err)
	}

	// Rollback: Redis now points at dep-2 (as the console writer would set it),
	// while the subdomain mapping must be untouched.
	kv.values[activeDeploymentRoutingKey(siteA)] = depB
	p.cache.Delete(activeDeploymentL1Key(siteA))

	dep, err := p.resolveActiveDeploymentID(context.Background(), siteA)
	if err != nil || dep != depB {
		t.Fatalf("expected %s after rollback, got=%q err=%v", depB, dep, err)
	}

	for _, s := range kv.sets {
		if s.key == subdomainRoutingKey("acme") {
			t.Fatalf("deployment/rollback must not rewrite the subdomain mapping: %+v", s)
		}
	}

	siteAfter, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil || siteAfter != siteA {
		t.Fatalf("site_id must be stable across deployments, got=%q err=%v", siteAfter, err)
	}
}

// ── malformed Redis values ──────────────────────────────────────────────────

func TestIsUUID(t *testing.T) {
	cases := map[string]bool{
		"11111111-1111-4111-8111-111111111111": true,
		"AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA": true,
		"":                                     false,
		"site-1":                               false,
		"11111111111141118111111111111111":     false,
		"11111111-1111-4111-8111-11111111111z": false,
		"11111111_1111-4111-8111-111111111111": false,
	}
	for in, want := range cases {
		if got := isUUID(in); got != want {
			t.Errorf("isUUID(%q) = %v, want %v", in, got, want)
		}
	}
}

func TestResolveSiteIDMalformedRedisValueFallsBackToPostgres(t *testing.T) {
	kv := &fakeRoutingKV{values: map[string]string{subdomainRoutingKey("acme"): "not-a-uuid"}}
	store := &fakeStore{sites: map[string]string{"acme": siteA}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveSiteID(context.Background(), "acme")
	if err != nil || got != siteA {
		t.Fatalf("malformed Redis value must fall back to Postgres: got=%q err=%v", got, err)
	}
	if store.siteCalls != 1 {
		t.Fatalf("expected PostgreSQL fallback, got %d calls", store.siteCalls)
	}
	if len(kv.sets) != 1 || kv.sets[0].value != siteA {
		t.Fatalf("expected Redis repair/backfill with %s, got %+v", siteA, kv.sets)
	}
}

func TestResolveActiveDeploymentMalformedRedisValueFallsBackToPostgres(t *testing.T) {
	kv := &fakeRoutingKV{values: map[string]string{activeDeploymentRoutingKey(siteA): "not-a-uuid"}}
	store := &fakeStore{deployments: map[string]string{siteA: depA}}
	p := newRoutingTestPlugin(kv, store)

	got, err := p.resolveActiveDeploymentID(context.Background(), siteA)
	if err != nil || got != depA {
		t.Fatalf("malformed Redis value must fall back to Postgres: got=%q err=%v", got, err)
	}
	if store.depCalls != 1 {
		t.Fatalf("expected PostgreSQL fallback, got %d calls", store.depCalls)
	}
	if len(kv.sets) != 1 || kv.sets[0].value != depA {
		t.Fatalf("expected Redis repair/backfill with %s, got %+v", depA, kv.sets)
	}
}

func TestPostgresStoreRejectsNonUUIDSiteIDWithoutQuerying(t *testing.T) {
	// A nil-db postgresStore must return a clean miss before touching the
	// database: the UUID guard rejects the value up front.
	store := postgresStore{}
	_, found, err := store.ActiveDeploymentBySite(context.Background(), "not-a-uuid")
	if err != nil || found {
		t.Fatalf("expected clean miss, got found=%v err=%v", found, err)
	}
}
