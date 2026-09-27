package cloudflare

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

// recorder captures the last request an httptest server received.
type recorder struct {
	method string
	path   string
	auth   string
	body   map[string]any
}

func newServer(t *testing.T, rec *recorder, response string) *httptest.Server {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec.method = r.Method
		rec.path = r.URL.Path
		rec.auth = r.Header.Get("authorization")
		if raw, err := io.ReadAll(r.Body); err == nil && len(raw) > 0 {
			_ = json.Unmarshal(raw, &rec.body)
		}
		w.Header().Set("content-type", "application/json")
		_, _ = w.Write([]byte(response))
	}))
	t.Cleanup(srv.Close)
	return srv
}

func newTestClient(t *testing.T, srv *httptest.Server, dlqID string) *Client {
	t.Helper()
	return NewClient(Options{
		AccountID:      "acct",
		QueueID:        "q1",
		Token:          "secret",
		DLQID:          dlqID,
		APIBase:        srv.URL,
		RequestTimeout: 5 * time.Second,
	})
}

func TestPull(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{
	  "success": true,
	  "result": {
	    "message_backlog_count": 2,
	    "messages": [
	      {"id":"m1","lease_id":"l1","body":"{\"type\":\"page_delete\"}","attempts":1},
	      {"id":"m2","lease_id":"l2","body":"{}","attempts":3}
	    ]
	  }
	}`)

	messages, err := newTestClient(t, srv, "").Pull(context.Background(), 10, 30*time.Second)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}

	if rec.method != http.MethodPost {
		t.Errorf("method = %s, want POST", rec.method)
	}
	if want := "/accounts/acct/queues/q1/messages/pull"; rec.path != want {
		t.Errorf("path = %s, want %s", rec.path, want)
	}
	if rec.auth != "Bearer secret" {
		t.Errorf("authorization = %q", rec.auth)
	}
	if got := rec.body["batch_size"]; got != float64(10) {
		t.Errorf("batch_size = %v, want 10", got)
	}
	if got := rec.body["visibility_timeout_ms"]; got != float64(30_000) {
		t.Errorf("visibility_timeout_ms = %v, want 30000", got)
	}

	if len(messages) != 2 {
		t.Fatalf("got %d messages, want 2", len(messages))
	}
	if messages[0].ID != "m1" || messages[0].LeaseID != "l1" || messages[0].Attempts != 1 {
		t.Errorf("first message = %+v", messages[0])
	}
}

func TestPullEmptyQueueIsNotAnError(t *testing.T) {
	srv := newServer(t, &recorder{}, `{"success":true,"result":{"message_backlog_count":0,"messages":[]}}`)

	messages, err := newTestClient(t, srv, "").Pull(context.Background(), 10, 30*time.Second)
	if err != nil {
		t.Fatalf("Pull: %v", err)
	}
	if len(messages) != 0 {
		t.Errorf("got %d messages, want 0", len(messages))
	}
}

func TestPullSuccessFalse(t *testing.T) {
	srv := newServer(t, &recorder{}, `{"success":false,"errors":[{"code":1000,"message":"nope"}]}`)

	if _, err := newTestClient(t, srv, "").Pull(context.Background(), 10, time.Second); err == nil {
		t.Fatal("Pull succeeded, want an error carrying the API detail")
	}
}

func TestPullNon2xxSurfacesTheBody(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"errors":[{"code":9109,"message":"bad token"}]}`))
	}))
	t.Cleanup(srv.Close)

	_, err := newTestClient(t, srv, "").Pull(context.Background(), 10, time.Second)
	if err == nil {
		t.Fatal("Pull succeeded on a 401, want an error")
	}
}

func TestAckBatch(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{"success":true}`)

	if err := newTestClient(t, srv, "").AckBatch(context.Background(), []string{"l1", "l2"}, []string{"l3"}); err != nil {
		t.Fatalf("AckBatch: %v", err)
	}

	if want := "/accounts/acct/queues/q1/messages/ack"; rec.path != want {
		t.Errorf("path = %s, want %s", rec.path, want)
	}

	acks, _ := rec.body["acks"].([]any)
	if len(acks) != 2 {
		t.Fatalf("acks = %v, want 2 entries", rec.body["acks"])
	}
	first, _ := acks[0].(map[string]any)
	if first["lease_id"] != "l1" {
		t.Errorf("acks[0] = %v, want lease_id l1", first)
	}

	retries, _ := rec.body["retries"].([]any)
	if len(retries) != 1 {
		t.Fatalf("retries = %v, want 1 entry", rec.body["retries"])
	}
}

func TestAckBatchSuccessFalse(t *testing.T) {
	srv := newServer(t, &recorder{}, `{"success":false,"errors":[{"code":7000,"message":"bad lease"}]}`)

	if err := newTestClient(t, srv, "").AckBatch(context.Background(), []string{"l1"}, nil); err == nil {
		t.Fatal("AckBatch succeeded, want an error")
	}
}

func TestPushToDLQ(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{"success":true}`)

	body := `{"type":"page_delete","page_id":"p1","site_id":"s1"}`
	if err := newTestClient(t, srv, "dlq1").PushToDLQ(context.Background(), []string{body}); err != nil {
		t.Fatalf("PushToDLQ: %v", err)
	}

	if want := "/accounts/acct/queues/dlq1/messages"; rec.path != want {
		t.Errorf("path = %s, want %s", rec.path, want)
	}
	// Cloudflare's push validator requires `body` to be a JSON *object*; sending
	// the serialized string back is rejected with code 10207.
	entry, ok := rec.body["body"].(map[string]any)
	if !ok {
		t.Fatalf("body = %#v, want a JSON object", rec.body["body"])
	}
	if entry["type"] != "page_delete" || entry["page_id"] != "p1" {
		t.Errorf("body = %v, want the original job", entry)
	}
}

func TestPushToDLQRejectsUnparseableBody(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{"success":true}`)

	if err := newTestClient(t, srv, "dlq1").PushToDLQ(context.Background(), []string{"not json"}); err == nil {
		t.Fatal("PushToDLQ succeeded with an unparseable body, want an error")
	}
	if rec.path != "" {
		t.Errorf("a request was sent to %s, want none", rec.path)
	}
}

func TestPushToDLQNoopWithoutDLQ(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{"success":true}`)

	// With no DLQ id the worker relies on the queue's own max_retries routing,
	// so nothing is sent.
	if err := newTestClient(t, srv, "").PushToDLQ(context.Background(), []string{"{}"}); err != nil {
		t.Fatalf("PushToDLQ: %v", err)
	}
	if rec.path != "" {
		t.Errorf("a request was sent to %s, want none", rec.path)
	}
}

func TestPushToDLQNoopWithNoBodies(t *testing.T) {
	rec := &recorder{}
	srv := newServer(t, rec, `{"success":true}`)

	if err := newTestClient(t, srv, "dlq1").PushToDLQ(context.Background(), nil); err != nil {
		t.Fatalf("PushToDLQ: %v", err)
	}
	if rec.path != "" {
		t.Errorf("a request was sent to %s, want none", rec.path)
	}
}

func TestToLeaseRefsSkipsEmpty(t *testing.T) {
	refs := toLeaseRefs([]string{"a", "", "b"})
	if len(refs) != 2 {
		t.Fatalf("got %d refs, want 2", len(refs))
	}
	if refs[0].LeaseID != "a" || refs[1].LeaseID != "b" {
		t.Errorf("refs = %+v", refs)
	}
}
