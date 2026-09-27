package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// call records one provisioning request.
type call struct {
	method string
	path   string
	body   map[string]any
}

// fakeCloudflare serves a mutable queue/consumer store and records every call.
type fakeCloudflare struct {
	queues    map[string]string // name → id
	consumers map[string][]map[string]any
	created   int
	updated   int
	calls     []call
}

func (f *fakeCloudflare) handler(t *testing.T) http.Handler {
	t.Helper()
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if raw, err := io.ReadAll(r.Body); err == nil && len(raw) > 0 {
			_ = json.Unmarshal(raw, &body)
		}
		f.calls = append(f.calls, call{method: r.Method, path: r.URL.Path, body: body})

		write := func(v any) {
			w.Header().Set("content-type", "application/json")
			_ = json.NewEncoder(w).Encode(v)
		}

		switch {
		// Collection endpoints.
		case r.Method == http.MethodGet && r.URL.Path == "/accounts/acct/queues":
			list := make([]map[string]any, 0, len(f.queues))
			for name, id := range f.queues {
				list = append(list, map[string]any{"queue_name": name, "queue_id": id})
			}
			write(map[string]any{"success": true, "result": list})

		case r.Method == http.MethodPost && r.URL.Path == "/accounts/acct/queues":
			name, _ := body["queue_name"].(string)
			if name == "" {
				t.Errorf("create queue sent no queue_name: %v", body)
			}
			if _, exists := f.queues[name]; exists {
				write(map[string]any{"success": false, "errors": []map[string]any{{"code": 10001, "message": "already exists"}}})
				return
			}
			id := "q-id-" + name
			f.queues[name] = id
			f.created++
			write(map[string]any{"success": true, "result": map[string]any{"queue_id": id, "queue_name": name}})

		case r.Method == http.MethodPatch:
			// Retention PATCH: settings only, no resource creation.
			write(map[string]any{"success": true, "result": map[string]any{}})

		case r.Method == http.MethodGet && r.URL.Path == "/accounts/acct/queues/"+f.queues["pagex-background"]+"/consumers":
			write(map[string]any{"success": true, "result": f.consumers["pagex-background"]})

		case r.Method == http.MethodPost && r.URL.Path == "/accounts/acct/queues/"+f.queues["pagex-background"]+"/consumers":
			if body["type"] != "http_pull" {
				t.Errorf("consumer type = %v, want http_pull", body["type"])
			}
			f.created++
			consumer := map[string]any{
				"consumer_id":       "consumer-1",
				"type":              "http_pull",
				"dead_letter_queue": body["dead_letter_queue"],
				"settings":          body["settings"],
			}
			f.consumers["pagex-background"] = []map[string]any{consumer}
			write(map[string]any{"success": true, "result": consumer})

		case r.Method == http.MethodPut:
			f.updated++
			// The path is /queues/{id}/consumers/{consumer_id}.
			parts := strings.Split(r.URL.Path, "/")
			if len(parts) < 7 {
				t.Errorf("PUT to an unexpected path: %s", r.URL.Path)
			}
			consumerID := parts[len(parts)-1]
			settings, _ := body["settings"].(map[string]any)
			consumer := map[string]any{
				"consumer_id":       consumerID,
				"type":              "http_pull",
				"dead_letter_queue": body["dead_letter_queue"],
				"settings":          settings,
			}
			f.consumers["pagex-background"] = []map[string]any{consumer}
			write(map[string]any{"success": true, "result": consumer})

		default:
			t.Errorf("unexpected %s %s", r.Method, r.URL.Path)
			write(map[string]any{"success": false, "errors": []map[string]any{{"code": 7003, "message": "no route"}}})
		}
	})
}

func newFake(t *testing.T) (*fakeCloudflare, *Provisioner) {
	t.Helper()
	fake := &fakeCloudflare{
		queues:    map[string]string{},
		consumers: map[string][]map[string]any{},
	}
	srv := httptest.NewServer(fake.handler(t))
	t.Cleanup(srv.Close)

	return fake, NewProvisioner(ProvisionOptions{
		AccountID:      "acct",
		Token:          "secret",
		QueueName:      "pagex-background",
		DLQName:        "pagex-background-dlq",
		BatchSize:      10,
		Visibility:     30 * time.Second,
		MaxRetries:     3,
		RetryDelay:     10 * time.Second,
		QueueRetention: 4 * 24 * time.Hour,
		APIBase:        srv.URL,
	})
}

func TestProvisionCreatesQueueAndConsumer(t *testing.T) {
	fake, p := newFake(t)

	result, err := p.Provision(context.Background())
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	if result.QueueID != "q-id-pagex-background" {
		t.Errorf("QueueID = %q", result.QueueID)
	}
	if result.DLQID != "q-id-pagex-background-dlq" {
		t.Errorf("DLQID = %q", result.DLQID)
	}
	if result.Consumer != "consumer-1" {
		t.Errorf("Consumer = %q, want consumer-1", result.Consumer)
	}
	if len(fake.queues) != 2 {
		t.Errorf("created %d queues, want 2", len(fake.queues))
	}

	// The DLQ must be created before the consumer that references it by name.
	var dlqAt, consumerAt = -1, -1
	for i, c := range fake.calls {
		if c.method == http.MethodPost && c.path == "/accounts/acct/queues" &&
			c.body["queue_name"] == "pagex-background-dlq" {
			dlqAt = i
		}
		if c.method == http.MethodPost && c.path == "/accounts/acct/queues/q-id-pagex-background/consumers" {
			consumerAt = i
		}
	}
	if dlqAt < 0 || consumerAt < 0 {
		t.Fatalf("expected both a DLQ create and a consumer create, calls=%+v", fake.calls)
	}
	if dlqAt > consumerAt {
		t.Error("the DLQ was created after the consumer that references it")
	}
}

func TestProvisionSendsConsumerSettings(t *testing.T) {
	fake, p := newFake(t)

	if _, err := p.Provision(context.Background()); err != nil {
		t.Fatalf("Provision: %v", err)
	}

	var settings map[string]any
	for _, c := range fake.calls {
		if c.method == http.MethodPost && c.path == "/accounts/acct/queues/q-id-pagex-background/consumers" {
			settings, _ = c.body["settings"].(map[string]any)
		}
	}
	if settings == nil {
		t.Fatal("no consumer settings were sent")
	}
	if settings["batch_size"] != float64(10) {
		t.Errorf("batch_size = %v, want 10", settings["batch_size"])
	}
	if settings["visibility_timeout_ms"] != float64(30_000) {
		t.Errorf("visibility_timeout_ms = %v, want 30000", settings["visibility_timeout_ms"])
	}
	if settings["max_retries"] != float64(3) {
		t.Errorf("max_retries = %v, want 3", settings["max_retries"])
	}
	if settings["retry_delay"] != float64(10) {
		t.Errorf("retry_delay = %v, want 10", settings["retry_delay"])
	}
}

// dead_letter_queue is a queue *name* in Cloudflare's API, not an ID.
func TestProvisionSendsDLQName(t *testing.T) {
	fake, p := newFake(t)

	if _, err := p.Provision(context.Background()); err != nil {
		t.Fatalf("Provision: %v", err)
	}

	checked := false
	for _, c := range fake.calls {
		if c.method != http.MethodPost ||
			c.path != "/accounts/acct/queues/q-id-pagex-background/consumers" {
			continue
		}
		checked = true
		if got := c.body["dead_letter_queue"]; got != "pagex-background-dlq" {
			t.Errorf("dead_letter_queue = %v, want the DLQ name", got)
		}
	}
	if !checked {
		t.Fatal("no consumer-create call was recorded")
	}
}

func TestProvisionPatchesRetention(t *testing.T) {
	fake, p := newFake(t)

	if _, err := p.Provision(context.Background()); err != nil {
		t.Fatalf("Provision: %v", err)
	}

	for _, c := range fake.calls {
		if c.method != http.MethodPatch {
			continue
		}
		settings, _ := c.body["settings"].(map[string]any)
		if got := settings["message_retention_period"]; got != float64(4*24*60*60) {
			t.Errorf("message_retention_period = %v, want %d", got, 4*24*60*60)
		}
	}
}

// Re-running provision must converge: no duplicate queues, and the existing
// consumer is updated in place rather than created again.
func TestProvisionIsIdempotent(t *testing.T) {
	fake, p := newFake(t)

	first, err := p.Provision(context.Background())
	if err != nil {
		t.Fatalf("first Provision: %v", err)
	}
	createdAfterFirst := fake.created

	second, err := p.Provision(context.Background())
	if err != nil {
		t.Fatalf("second Provision: %v", err)
	}

	if first.QueueID != second.QueueID || first.DLQID != second.DLQID || first.Consumer != second.Consumer {
		t.Errorf("resources changed between runs: %+v then %+v", first, second)
	}
	if len(fake.queues) != 2 {
		t.Errorf("created %d queues after two runs, want 2", len(fake.queues))
	}
	if fake.created != createdAfterFirst {
		t.Errorf("second run created %d more resources, want 0", fake.created-createdAfterFirst)
	}
	if fake.updated == 0 {
		t.Error("second run did not PUT the existing consumer, so settings would drift")
	}
}

// A queue created out of band (wrangler, dashboard) must be adopted, not
// duplicated.
func TestProvisionAdoptsExistingQueues(t *testing.T) {
	fake, p := newFake(t)
	fake.queues["pagex-background"] = "pre-existing"
	fake.queues["pagex-background-dlq"] = "pre-existing-dlq"
	fake.consumers["pagex-background"] = []map[string]any{{
		"consumer_id": "existing-consumer",
		"type":        "http_pull",
	}}

	result, err := p.Provision(context.Background())
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}

	if result.QueueID != "pre-existing" {
		t.Errorf("QueueID = %q, want the pre-existing id", result.QueueID)
	}
	if result.Consumer != "existing-consumer" {
		t.Errorf("Consumer = %q, want the pre-existing id", result.Consumer)
	}
	if fake.created != 0 {
		t.Errorf("created %d resources, want 0", fake.created)
	}
}

// A Worker consumer on the same queue must not be mistaken for the HTTP pull
// one, and must not be mutated.
func TestProvisionIgnoresWorkerConsumers(t *testing.T) {
	fake, p := newFake(t)
	fake.queues["pagex-background"] = "q1"
	fake.queues["pagex-background-dlq"] = "dlq1"
	fake.consumers["pagex-background"] = []map[string]any{
		{"consumer_id": "worker-consumer", "type": "worker", "script_name": "my-worker"},
	}

	result, err := p.Provision(context.Background())
	if err != nil {
		t.Fatalf("Provision: %v", err)
	}
	if result.Consumer != "consumer-1" {
		t.Errorf("Consumer = %q, want a newly created http_pull consumer", result.Consumer)
	}
	for _, c := range fake.calls {
		if c.method == http.MethodPut && c.path == "/accounts/acct/queues/q1/consumers/worker-consumer" {
			t.Error("the Worker consumer was updated, which would break it")
		}
	}
}

func TestProvisionFailsWhenCreateReturnsNoID(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("content-type", "application/json")
		if r.Method == http.MethodGet {
			_, _ = w.Write([]byte(`{"success":true,"result":[]}`))
			return
		}
		_, _ = w.Write([]byte(`{"success":true,"result":{}}`))
	}))
	t.Cleanup(srv.Close)

	p := NewProvisioner(ProvisionOptions{
		AccountID: "acct", Token: "t",
		QueueName: "pagex-background", DLQName: "pagex-background-dlq",
		APIBase: srv.URL,
	})

	if _, err := p.Provision(context.Background()); err == nil {
		t.Fatal("Provision succeeded with an empty queue_id, want an error")
	}
}
