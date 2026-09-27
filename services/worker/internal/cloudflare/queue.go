// Package cloudflare implements a Cloudflare Queues HTTP pull consumer.
//
// The worker is a plain long-running Go process — there is no Cloudflare Worker
// binding and no Redis/BullMQ queue anywhere in the path:
//
//	Queue ──HTTP pull──► Go worker ──process job──► ACK
//
// Three endpoints are used:
//
//	POST /accounts/{a}/queues/{q}/messages/pull   → lease a batch
//	POST /accounts/{a}/queues/{q}/messages/ack    → ACK and/or retry leases
//	POST /accounts/{a}/queues/{dlq}/messages      → push to the dead-letter queue
//
// A lease that is neither acked nor retried simply expires when the visibility
// timeout lapses, and Cloudflare redelivers it — that is the safety net behind
// "ACK only after successful cleanup".
package cloudflare

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

// DefaultAPIBase is Cloudflare's v4 REST endpoint.
const DefaultAPIBase = "https://api.cloudflare.com/client/v4"

// Message is a single leased queue message.
type Message struct {
	ID         string            `json:"id"`
	LeaseID    string            `json:"lease_id"`
	Body       string            `json:"body"`
	Attempts   int               `json:"attempts"`
	Timestamp  int64             `json:"timestamp_ms"`
	Metadata   map[string]string `json:"metadata"`
	HTTPStatus json.RawMessage   `json:"http_status"`
}

// Options configures a Client.
type Options struct {
	AccountID string
	QueueID   string
	Token     string
	// DLQID, when set, is where a job is pushed after the worker's local retry
	// budget is exhausted. Empty disables explicit dead-lettering and relies on
	// the queue's own max_retries → dead_letter_queue routing.
	DLQID string
	// APIBase overrides the REST host. Empty means DefaultAPIBase; tests point
	// it at an httptest.Server.
	APIBase        string
	HTTPClient     *http.Client
	RequestTimeout time.Duration
}

// Client is an HTTP pull consumer for a single queue.
type Client struct {
	opts     Options
	endpoint string
	dlqURL   string
	http     *http.Client
}

// NewClient builds a queue client. RequestTimeout bounds every API call.
func NewClient(opts Options) *Client {
	timeout := opts.RequestTimeout
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	httpClient := opts.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: timeout}
	}

	base := opts.APIBase
	if base == "" {
		base = DefaultAPIBase
	}
	base = strings.TrimSuffix(base, "/")

	dlqURL := ""
	if opts.DLQID != "" {
		dlqURL = fmt.Sprintf("%s/accounts/%s/queues/%s/messages", base, opts.AccountID, opts.DLQID)
	}

	return &Client{
		opts:     opts,
		endpoint: fmt.Sprintf("%s/accounts/%s/queues/%s", base, opts.AccountID, opts.QueueID),
		dlqURL:   dlqURL,
		http:     httpClient,
	}
}

// Pull leases up to batchSize messages with the given visibility timeout.
// An empty queue is not an error: it returns an empty slice and a nil error.
func (c *Client) Pull(ctx context.Context, batchSize int, visibility time.Duration) ([]Message, error) {
	payload := map[string]any{
		"batch_size":            batchSize,
		"visibility_timeout_ms": int(visibility.Milliseconds()),
	}

	var out struct {
		Success bool       `json:"success"`
		Errors  []apiError `json:"errors"`
		Result  pullResult `json:"result"`
	}

	if err := c.post(ctx, c.endpoint+"/messages/pull", payload, &out); err != nil {
		return nil, err
	}
	if !out.Success {
		return nil, fmt.Errorf("pull failed: %s", formatErrors(out.Errors))
	}
	return out.Result.Messages, nil
}

type pullResult struct {
	MessageBacklogCount int       `json:"message_backlog_count"`
	Messages            []Message `json:"messages"`
}

// leaseRef is the ack/retry payload shape.
type leaseRef struct {
	LeaseID string `json:"lease_id"`
}

// AckBatch settles a whole pull in one call: successful jobs are acked, failed
// ones are retried. Empty lists are valid.
func (c *Client) AckBatch(ctx context.Context, ack, retry []string) error {
	payload := map[string]any{
		"acks":    toLeaseRefs(ack),
		"retries": toLeaseRefs(retry),
	}

	var out struct {
		Success bool       `json:"success"`
		Errors  []apiError `json:"errors"`
	}
	if err := c.post(ctx, c.endpoint+"/messages/ack", payload, &out); err != nil {
		return err
	}
	if !out.Success {
		return fmt.Errorf("ack failed: %s", formatErrors(out.Errors))
	}
	return nil
}

// PushToDLQ publishes a dead-letter copy of a failed job. It is a no-op when no
// DLQ is configured — Cloudflare then moves the message to the queue's own
// dead-letter queue once max_retries is exhausted.
//
// A pulled body is the *serialized* job, but Cloudflare's push validator
// requires `body` to be a JSON object ("Expected object, received string at
// body"), so each body is decoded back into an object before republishing. The
// original lease is deliberately left unsettled: it then expires and Cloudflare
// routes it to the same DLQ on its own, which keeps one copy per failure.
func (c *Client) PushToDLQ(ctx context.Context, bodies []string) error {
	if c.dlqURL == "" || len(bodies) == 0 {
		return nil
	}

	for _, raw := range bodies {
		var body any
		if err := json.Unmarshal([]byte(raw), &body); err != nil {
			return fmt.Errorf("decode body for dlq push: %w", err)
		}

		var out struct {
			Success bool       `json:"success"`
			Errors  []apiError `json:"errors"`
		}
		if err := c.post(ctx, c.dlqURL, map[string]any{"body": body}, &out); err != nil {
			return err
		}
		if !out.Success {
			return fmt.Errorf("dlq push failed: %s", formatErrors(out.Errors))
		}
	}
	return nil
}

func toLeaseRefs(ids []string) []leaseRef {
	refs := make([]leaseRef, 0, len(ids))
	for _, id := range ids {
		if id != "" {
			refs = append(refs, leaseRef{LeaseID: id})
		}
	}
	return refs
}

func (c *Client) post(ctx context.Context, path string, body any, out any) error {
	return c.do(ctx, http.MethodPost, path, body, out)
}

func (c *Client) do(ctx context.Context, method, path string, body any, out any) error {
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return fmt.Errorf("marshal request: %w", err)
		}
		reader = bytes.NewReader(encoded)
	}

	req, err := http.NewRequestWithContext(ctx, method, path, reader)
	if err != nil {
		return fmt.Errorf("build request: %w", err)
	}
	if body != nil {
		req.Header.Set("content-type", "application/json")
	}
	req.Header.Set("authorization", "Bearer "+c.opts.Token)

	res, err := c.http.Do(req)
	if err != nil {
		return fmt.Errorf("%s %s: %w", method, path, err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode > 299 {
		snippet, _ := io.ReadAll(io.LimitReader(res.Body, 2048))
		return fmt.Errorf("%s %s: unexpected status %d: %s",
			method, path, res.StatusCode, strings.TrimSpace(string(snippet)))
	}

	if out == nil {
		return nil
	}
	return decodeJSON(res, out)
}

func decodeJSON(res *http.Response, out any) error {
	if err := json.NewDecoder(res.Body).Decode(out); err != nil {
		return fmt.Errorf("decode response: %w", err)
	}
	return nil
}

type apiError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

func formatErrors(errs []apiError) string {
	if len(errs) == 0 {
		return "no error detail"
	}
	parts := make([]string, 0, len(errs))
	for _, e := range errs {
		parts = append(parts, fmt.Sprintf("%d %s", e.Code, e.Message))
	}
	return strings.Join(parts, "; ")
}
