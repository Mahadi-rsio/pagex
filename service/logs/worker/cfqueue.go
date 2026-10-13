package main

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type queueClient struct {
	accountID string
	queueID   string
	token     string
	http      *http.Client
}

func newQueueClient(accountID, queueID, token string) *queueClient {
	return &queueClient{
		accountID: accountID,
		queueID:   queueID,
		token:     token,
		http:      &http.Client{Timeout: 30 * time.Second},
	}
}

type queueMessage struct {
	Body     string `json:"body"`
	ID       string `json:"id"`
	LeaseID  string `json:"lease_id"`
	Attempts int    `json:"attempts"`
}

type cfError struct {
	Code    int    `json:"code"`
	Message string `json:"message"`
}

type pullResponse struct {
	Success bool      `json:"success"`
	Errors  []cfError `json:"errors"`
	Result  struct {
		Backlog  int            `json:"message_backlog_count"`
		Messages []queueMessage `json:"messages"`
	} `json:"result"`
}

type ackResponse struct {
	Success bool      `json:"success"`
	Errors  []cfError `json:"errors"`
}

// pull leases up to batchSize messages for visibilityTimeoutMs milliseconds.
func (q *queueClient) pull(ctx context.Context, batchSize, visibilityTimeoutMs int) ([]queueMessage, error) {
	payload, err := json.Marshal(map[string]int{
		"batch_size":            batchSize,
		"visibility_timeout_ms": visibilityTimeoutMs,
	})
	if err != nil {
		return nil, err
	}

	body, err := q.do(ctx, "/messages/pull", payload)
	if err != nil {
		return nil, err
	}
	defer body.Close()

	var out pullResponse
	if err := json.NewDecoder(body).Decode(&out); err != nil {
		return nil, fmt.Errorf("decode pull response: %w", err)
	}
	if !out.Success {
		return nil, fmt.Errorf("queue pull failed: %s", formatErrors(out.Errors))
	}
	return out.Result.Messages, nil
}

// ack acknowledges the given lease IDs; retries are returned to the queue.
func (q *queueClient) ack(ctx context.Context, acks, retries []string) error {
	type lease struct {
		LeaseID string `json:"lease_id"`
	}
	type retry struct {
		LeaseID string `json:"lease_id"`
	}

	payload := struct {
		Acks    []lease `json:"acks"`
		Retries []retry `json:"retries"`
	}{
		Acks:    make([]lease, 0, len(acks)),
		Retries: make([]retry, 0, len(retries)),
	}
	for _, id := range acks {
		payload.Acks = append(payload.Acks, lease{LeaseID: id})
	}
	for _, id := range retries {
		payload.Retries = append(payload.Retries, retry{LeaseID: id})
	}

	raw, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	body, err := q.do(ctx, "/messages/ack", raw)
	if err != nil {
		return err
	}
	defer body.Close()

	var out ackResponse
	if err := json.NewDecoder(body).Decode(&out); err != nil {
		return fmt.Errorf("decode ack response: %w", err)
	}
	if !out.Success {
		return fmt.Errorf("queue ack failed: %s", formatErrors(out.Errors))
	}
	return nil
}

func (q *queueClient) do(ctx context.Context, path string, payload []byte) (io.ReadCloser, error) {
	url := fmt.Sprintf("https://api.cloudflare.com/client/v4/accounts/%s/queues/%s%s", q.accountID, q.queueID, path)
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(payload))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+q.token)
	req.Header.Set("Content-Type", "application/json")

	resp, err := q.http.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, fmt.Errorf("queue API %s: HTTP %d: %s", path, resp.StatusCode, strings.TrimSpace(string(msg)))
	}
	return resp.Body, nil
}

func formatErrors(errs []cfError) string {
	if len(errs) == 0 {
		return "unknown error"
	}
	parts := make([]string, 0, len(errs))
	for _, e := range errs {
		parts = append(parts, fmt.Sprintf("%d: %s", e.Code, e.Message))
	}
	return strings.Join(parts, "; ")
}

type r2Event struct {
	Action string `json:"action"`
	Bucket string `json:"bucket"`
	Object struct {
		Key  string `json:"key"`
		Size int64  `json:"size"`
	} `json:"object"`
}

// extractObjectKey pulls the R2 object key out of an event-notification queue
// message. Cloudflare Queues base64-encode json/bytes bodies, so the raw body
// may be base64 of the event JSON.
func extractObjectKey(raw string) (string, error) {
	body := strings.TrimSpace(raw)
	if b, err := decodeBase64(body); err == nil && json.Valid(b) {
		body = string(b)
	}

	if json.Valid([]byte(body)) {
		var ev r2Event
		if err := json.Unmarshal([]byte(body), &ev); err != nil {
			return "", fmt.Errorf("decode R2 event: %w", err)
		}
		if ev.Object.Key == "" {
			return "", fmt.Errorf("R2 event missing object.key")
		}
		return ev.Object.Key, nil
	}

	if isObjectKey(body) {
		return body, nil
	}
	return "", fmt.Errorf("unrecognized queue message body")
}

func decodeBase64(s string) ([]byte, error) {
	if b, err := base64.StdEncoding.DecodeString(s); err == nil {
		return b, nil
	}
	return base64.RawStdEncoding.DecodeString(s)
}

// isObjectKey is a light sanity check for a plain object-key body.
func isObjectKey(s string) bool {
	if s == "" || strings.ContainsAny(s, " \t\r\n{}") {
		return false
	}
	return strings.Contains(s, "/")
}
