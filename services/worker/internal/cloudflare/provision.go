package cloudflare

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// Provisioner creates the `pagex-background` queue, its dead-letter queue, and
// the HTTP pull consumer that points at it.
//
// Idempotent by construction: every step is a read-then-create-or-update, so
// running `worker provision` on every deploy converges on the desired state
// instead of duplicating resources.
//
// API shapes this targets (Cloudflare Queues v4):
//
//	POST   /accounts/{a}/queues                                       {queue_name}
//	GET    /accounts/{a}/queues?per_page=100
//	GET    /accounts/{a}/queues/{q}/consumers
//	POST   /accounts/{a}/queues/{q}/consumers                        {type:"http_pull", …}
//	PUT    /accounts/{a}/queues/{q}/consumers/{consumer_id}           {type:"http_pull", …}
//
// Note that `dead_letter_queue` is a queue *name*, not an ID, and that retry /
// batch / visibility settings live on the consumer rather than the queue.
type Provisioner struct {
	accountID string
	token     string
	queueName string
	dlqName   string

	// BatchSize / VisibilityTimeout / MaxRetries / RetryDelay are written to
	// the HTTP pull consumer. Concurrent handlers inside the worker process are
	// governed by WORKER_CONCURRENCY, not by this value.
	batchSize      int
	visibility     time.Duration
	maxRetries     int
	retryDelay     time.Duration
	queueRetention time.Duration
	http           *http.Client
	apiBase        string
}

// ProvisionOptions configures a Provisioner.
type ProvisionOptions struct {
	AccountID      string
	Token          string
	QueueName      string
	DLQName        string
	BatchSize      int
	Visibility     time.Duration
	MaxRetries     int
	RetryDelay     time.Duration
	QueueRetention time.Duration
	APIBase        string
	HTTPClient     *http.Client
}

// NewProvisioner builds a provisioner from options.
func NewProvisioner(o ProvisionOptions) *Provisioner {
	httpClient := o.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: 60 * time.Second}
	}
	base := o.APIBase
	if base == "" {
		base = DefaultAPIBase
	}
	return &Provisioner{
		accountID:      o.AccountID,
		token:          o.Token,
		queueName:      o.QueueName,
		dlqName:        o.DLQName,
		batchSize:      o.BatchSize,
		visibility:     o.Visibility,
		maxRetries:     o.MaxRetries,
		retryDelay:     o.RetryDelay,
		queueRetention: o.QueueRetention,
		http:           httpClient,
		apiBase:        base,
	}
}

// ProvisionResult reports what exists after a provisioning run.
type ProvisionResult struct {
	QueueID   string
	DLQID     string
	QueueName string
	DLQName   string
	Consumer  string
}

// Provision ensures the DLQ, the queue, and its HTTP pull consumer exist.
func (p *Provisioner) Provision(ctx context.Context) (*ProvisionResult, error) {
	// The DLQ must exist first: the consumer references it by name.
	dlqID, created, err := p.ensureQueue(ctx, p.dlqName)
	if err != nil {
		return nil, fmt.Errorf("ensure dead-letter queue %q: %w", p.dlqName, err)
	}
	slog.Info("dead-letter queue ready", "name", p.dlqName, "id", dlqID, "created", created)

	queueID, created, err := p.ensureQueue(ctx, p.queueName)
	if err != nil {
		return nil, fmt.Errorf("ensure queue %q: %w", p.queueName, err)
	}
	slog.Info("queue ready", "name", p.queueName, "id", queueID, "created", created)

	consumer, created, err := p.ensureHTTPConsumer(ctx, queueID)
	if err != nil {
		return nil, fmt.Errorf("ensure http_pull consumer on %q: %w", p.queueName, err)
	}
	slog.Info("http_pull consumer ready", "queue", p.queueName, "consumer_id", consumer, "created", created)

	return &ProvisionResult{
		QueueID:   queueID,
		DLQID:     dlqID,
		QueueName: p.queueName,
		DLQName:   p.dlqName,
		Consumer:  consumer,
	}, nil
}

type queueInfo struct {
	QueueID   string `json:"queue_id"`
	QueueName string `json:"queue_name"`
	Settings  struct {
		DeliveryDelay          int  `json:"delivery_delay"`
		DeliveryPaused         bool `json:"delivery_paused"`
		MessageRetentionPeriod int  `json:"message_retention_period"`
	} `json:"settings"`
}

// ensureQueue returns the queue ID and whether it had to be created.
func (p *Provisioner) ensureQueue(ctx context.Context, name string) (string, bool, error) {
	existing, err := p.findQueue(ctx, name)
	if err != nil {
		return "", false, err
	}
	if existing != "" {
		p.updateQueueSettings(ctx, existing, name)
		return existing, false, nil
	}

	// `POST /queues` accepts only `queue_name`; every tuning knob is a consumer
	// setting or a PATCH afterwards.
	var out struct {
		Success bool       `json:"success"`
		Errors  []apiError `json:"errors"`
		Result  queueInfo  `json:"result"`
	}
	body := map[string]any{"queue_name": name}
	if err := p.do(ctx, http.MethodPost, p.queuesPath(), body, &out); err != nil {
		return "", false, err
	}
	if !out.Success {
		return "", false, fmt.Errorf("create queue %q: %s", name, formatErrors(out.Errors))
	}
	if out.Result.QueueID == "" {
		return "", false, fmt.Errorf("create queue %q returned no queue_id", name)
	}
	p.updateQueueSettings(ctx, out.Result.QueueID, name)
	return out.Result.QueueID, true, nil
}

// updateQueueSettings applies the retention window. `PATCH /queues/{id}` is the
// only write for these values; a zero retention keeps Cloudflare's default.
//
// This is best effort on purpose. Retention is a tuning knob, not a
// correctness requirement, and Cloudflare answers 500 on the PATCH for some
// plans — provisioning must still converge on a working queue, and the API
// default (4 days) is already a sane retention.
func (p *Provisioner) updateQueueSettings(ctx context.Context, queueID, name string) {
	if p.queueRetention <= 0 {
		return
	}
	settings := map[string]any{
		"message_retention_period": int(p.queueRetention.Seconds()),
	}
	var out struct {
		Success bool       `json:"success"`
		Errors  []apiError `json:"errors"`
	}
	path := fmt.Sprintf("%s/accounts/%s/queues/%s", p.apiBase, p.accountID, queueID)
	if err := p.do(ctx, http.MethodPatch, path, map[string]any{"settings": settings}, &out); err != nil {
		slog.Warn("could not set queue retention; keeping the Cloudflare default",
			"queue", name, "error", err)
		return
	}
	if !out.Success {
		slog.Warn("could not set queue retention; keeping the Cloudflare default",
			"queue", name, "errors", formatErrors(out.Errors))
	}
}

// findQueue returns the ID of an existing queue by name, or "" when absent.
func (p *Provisioner) findQueue(ctx context.Context, name string) (string, error) {
	var out struct {
		Success bool        `json:"success"`
		Errors  []apiError  `json:"errors"`
		Result  []queueInfo `json:"result"`
	}
	if err := p.do(ctx, http.MethodGet, p.queuesPath()+"?per_page=100", nil, &out); err != nil {
		return "", err
	}
	if !out.Success {
		return "", fmt.Errorf("list queues: %s", formatErrors(out.Errors))
	}
	for _, q := range out.Result {
		if q.QueueName == name && q.QueueID != "" {
			return q.QueueID, nil
		}
	}
	return "", nil
}

type consumerInfo struct {
	ConsumerID      string `json:"consumer_id"`
	Type            string `json:"type"`
	DeadLetterQueue string `json:"dead_letter_queue"`
	QueueName       string `json:"queue_name"`
	Settings        struct {
		BatchSize         int `json:"batch_size"`
		MaxRetries        int `json:"max_retries"`
		RetryDelay        int `json:"retry_delay"`
		VisibilityTimeout int `json:"visibility_timeout_ms"`
	} `json:"settings"`
}

// ensureHTTPConsumer creates the http_pull consumer, or updates the existing
// one so changed WORKER_* settings actually reach Cloudflare. It returns the
// consumer ID and whether it had to be created.
//
// The same settings are also sent per-pull, so the dashboard stays accurate even
// if someone edits them out of band.
func (p *Provisioner) ensureHTTPConsumer(ctx context.Context, queueID string) (string, bool, error) {
	path := fmt.Sprintf("%s/accounts/%s/queues/%s/consumers", p.apiBase, p.accountID, queueID)

	var list struct {
		Success bool           `json:"success"`
		Result  []consumerInfo `json:"result"`
	}
	// A failure here is fatal for provisioning, not a reason to skip the update.
	if err := p.do(ctx, http.MethodGet, path, nil, &list); err != nil {
		return "", false, fmt.Errorf("list consumers: %w", err)
	}

	body := map[string]any{
		"type":              "http_pull",
		"dead_letter_queue": p.dlqName,
		"settings": map[string]any{
			"batch_size":            p.batchSize,
			"max_retries":           p.maxRetries,
			"retry_delay":           int(p.retryDelay.Seconds()),
			"visibility_timeout_ms": int(p.visibility.Milliseconds()),
		},
	}

	var out struct {
		Success bool         `json:"success"`
		Errors  []apiError   `json:"errors"`
		Result  consumerInfo `json:"result"`
	}

	for _, c := range list.Result {
		if c.Type != "http_pull" || c.ConsumerID == "" {
			continue
		}
		updatePath := path + "/" + c.ConsumerID
		if err := p.do(ctx, http.MethodPut, updatePath, body, &out); err != nil {
			return "", false, err
		}
		if !out.Success {
			return "", false, fmt.Errorf("update consumer %s: %s", c.ConsumerID, formatErrors(out.Errors))
		}
		id := out.Result.ConsumerID
		if id == "" {
			id = c.ConsumerID
		}
		return id, false, nil
	}

	if err := p.do(ctx, http.MethodPost, path, body, &out); err != nil {
		return "", false, err
	}
	if !out.Success {
		return "", false, fmt.Errorf("create consumer: %s", formatErrors(out.Errors))
	}
	if out.Result.ConsumerID == "" {
		return "", false, fmt.Errorf("create consumer returned no consumer_id")
	}
	return out.Result.ConsumerID, true, nil
}

func (p *Provisioner) queuesPath() string {
	return fmt.Sprintf("%s/accounts/%s/queues", p.apiBase, p.accountID)
}

func (p *Provisioner) do(ctx context.Context, method, path string, body any, out any) error {
	c := &Client{opts: Options{Token: p.token}, http: p.http}
	return c.do(ctx, method, path, body, out)
}
