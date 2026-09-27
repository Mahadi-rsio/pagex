// Package worker contains the Cloudflare Queues HTTP pull consumer loop.
//
//	Queue ──HTTP pull──► Go worker ──process job──► ACK
//
// WORKER_CONCURRENCY jobs are processed at once out of each pulled batch, and a
// batch is only settled once every job in it has finished: successful jobs are
// ACKed, failures are retried. A lease that is never settled expires with the
// visibility timeout and is redelivered, so a crash mid-batch loses nothing.
package worker

import (
	"context"
	"log/slog"
	"sync"
	"time"

	"github.com/Mahadi-rsio/pagex-worker/internal/cloudflare"
	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
)

// Queue is the subset of the Cloudflare pull consumer the loop depends on.
// Depending on the interface rather than *cloudflare.Client keeps the loop
// testable without a network or credentials.
type Queue interface {
	// Pull leases up to batchSize messages for the given visibility timeout.
	// An empty queue returns an empty slice and a nil error.
	Pull(ctx context.Context, batchSize int, visibility time.Duration) ([]cloudflare.Message, error)
	// AckBatch settles a whole pull: ack the successes, retry the failures.
	AckBatch(ctx context.Context, ack, retry []string) error
	// PushToDLQ publishes dead-letter copies of jobs that exhausted retries.
	PushToDLQ(ctx context.Context, bodies []string) error
}

// Options configures the consumer loop.
type Options struct {
	Queue             Queue
	Dispatcher        *jobs.Dispatcher
	Concurrency       int
	BatchSize         int
	VisibilityTimeout time.Duration
	PollInterval      time.Duration
	// MaxAttempts is how many deliveries of one job are tolerated before it is
	// pushed to the dead-letter queue. Cloudflare's own max_retries on the
	// consumer remains the outer backstop.
	MaxAttempts int
}

// Consumer is the pull loop.
type Consumer struct {
	opts Options

	mu       sync.Mutex
	attempts map[string]int // message ID → local failed attempts
}

// New builds a consumer.
func New(opts Options) *Consumer {
	return &Consumer{opts: opts, attempts: make(map[string]int)}
}

// Run pulls and processes messages until ctx is cancelled. It returns nil on a
// clean shutdown.
func (c *Consumer) Run(ctx context.Context) error {
	slog.Info("worker started",
		"concurrency", c.opts.Concurrency,
		"batch_size", c.opts.BatchSize,
		"visibility_timeout", c.opts.VisibilityTimeout,
		"max_attempts", c.opts.MaxAttempts,
		"poll_interval", c.opts.PollInterval)

	for {
		if ctx.Err() != nil {
			slog.Info("worker stopped")
			return nil
		}

		pulled, err := c.pullAndProcess(ctx)
		if err != nil {
			if ctx.Err() != nil {
				slog.Info("worker stopped")
				return nil
			}
			slog.Error("pull failed; backing off", "error", err)
			if !sleepCtx(ctx, c.opts.PollInterval) {
				return nil
			}
			continue
		}

		// An empty queue is the normal idle case: poll again after the interval
		// instead of spinning.
		if pulled == 0 && !sleepCtx(ctx, c.opts.PollInterval) {
			return nil
		}
	}
}

// pullAndProcess processes one batch and settles it. The returned count is the
// number of messages handled.
func (c *Consumer) pullAndProcess(ctx context.Context) (int, error) {
	messages, err := c.opts.Queue.Pull(ctx, c.opts.BatchSize, c.opts.VisibilityTimeout)
	if err != nil {
		return 0, err
	}
	if len(messages) == 0 {
		return 0, nil
	}

	acks, retries, dlq := c.processBatch(ctx, messages)

	// Settle the batch. A failure here is not fatal: unsettled leases are
	// redelivered after the visibility timeout, and the cleanup handlers are
	// idempotent, so at-least-once delivery is safe.
	if err := c.opts.Queue.AckBatch(ctx, acks, retries); err != nil {
		slog.Error("ack batch failed; unsettled leases will be redelivered",
			"error", err, "acked", len(acks), "retried", len(retries))
	}

	if len(dlq) > 0 {
		if err := c.opts.Queue.PushToDLQ(ctx, dlq); err != nil {
			slog.Error("dead-letter push failed", "error", err, "jobs", len(dlq))
		} else {
			slog.Warn("moved jobs to the dead-letter queue", "jobs", len(dlq))
		}
	}

	slog.Debug("batch settled",
		"pulled", len(messages),
		"acked", len(acks),
		"retried", len(retries),
		"dead_lettered", len(dlq))

	return len(messages), nil
}

// outcome is the per-message result of processBatch.
type outcome struct {
	lease  string
	body   string
	failed bool
}

// processBatch runs at most Concurrency handlers at a time and partitions the
// batch into ack / retry / dead-letter lists.
func (c *Consumer) processBatch(ctx context.Context, messages []cloudflare.Message) (acks, retries, dlq []string) {
	results := make([]outcome, len(messages))
	sem := make(chan struct{}, c.opts.Concurrency)
	var wg sync.WaitGroup

	for i, msg := range messages {
		wg.Add(1)
		go func(idx int, m cloudflare.Message) {
			defer wg.Done()

			sem <- struct{}{}
			defer func() { <-sem }()

			// ACK only after the cleanup succeeded. An unparseable body is
			// ACKed too: retrying it forever would wedge the queue behind a
			// message no handler can ever satisfy.
			job, err := jobs.Parse(m.Body)
			if err != nil {
				slog.Error("dropping unparseable job",
					"message_id", m.ID, "attempts", m.Attempts, "error", err)
				results[idx] = outcome{lease: m.LeaseID}
				return
			}
			job.Attempts = m.Attempts

			if err := c.opts.Dispatcher.Dispatch(ctx, job); err != nil {
				slog.Error("job failed",
					"type", job.Type,
					"page_id", job.PageID,
					"site_id", job.SiteID,
					"attempts", m.Attempts,
					"error", err)
				results[idx] = outcome{lease: m.LeaseID, body: m.Body, failed: true}
				return
			}

			slog.Info("job processed",
				"type", job.Type,
				"page_id", job.PageID,
				"site_id", job.SiteID,
				"attempts", m.Attempts)
			results[idx] = outcome{lease: m.LeaseID}
		}(i, msg)
	}
	wg.Wait()

	for i, r := range results {
		if r.lease == "" {
			continue
		}
		switch {
		case !r.failed:
			acks = append(acks, r.lease)
			c.clearAttempts(messages[i].ID)
		case c.exhausted(messages[i]):
			dlq = append(dlq, r.body)
			c.clearAttempts(messages[i].ID)
		default:
			retries = append(retries, r.lease)
		}
	}
	return acks, retries, dlq
}

// exhausted reports whether a job has used up its retry budget, counting both
// this process's failures and Cloudflare's own delivery counter so a job that
// bounces between worker instances still reaches the DLQ.
func (c *Consumer) exhausted(msg cloudflare.Message) bool {
	c.mu.Lock()
	c.attempts[msg.ID]++
	local := c.attempts[msg.ID]
	c.mu.Unlock()

	if local >= c.opts.MaxAttempts || msg.Attempts >= c.opts.MaxAttempts {
		slog.Error("job exhausted retries; dead-lettering",
			"message_id", msg.ID,
			"local_attempts", local,
			"delivery_attempts", msg.Attempts)
		return true
	}
	return false
}

func (c *Consumer) clearAttempts(messageID string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.attempts, messageID)
}

func sleepCtx(ctx context.Context, d time.Duration) bool {
	if d <= 0 {
		d = time.Second
	}
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}
