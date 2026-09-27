package worker

import (
	"context"
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/Mahadi-rsio/pagex-worker/internal/cloudflare"
	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
)

// recordingQueue is a scriptable Queue that captures the settlements the
// consumer sends.
type recordingQueue struct {
	mu         sync.Mutex
	messages   []cloudflare.Message
	pullErr    error
	acks       []string
	retries    []string
	dlq        []string
	dlqCalls   int
	pullCalls  int
	lastBatch  int
	lastVisibl time.Duration
}

func (q *recordingQueue) Pull(_ context.Context, batchSize int, visibility time.Duration) ([]cloudflare.Message, error) {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.pullCalls++
	q.lastBatch = batchSize
	q.lastVisibl = visibility
	if q.pullErr != nil {
		return nil, q.pullErr
	}
	out := q.messages
	q.messages = nil
	return out, nil
}

func (q *recordingQueue) AckBatch(_ context.Context, ack, retry []string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.acks = append(q.acks, ack...)
	q.retries = append(q.retries, retry...)
	return nil
}

func (q *recordingQueue) PushToDLQ(_ context.Context, bodies []string) error {
	q.mu.Lock()
	defer q.mu.Unlock()
	q.dlqCalls++
	q.dlq = append(q.dlq, bodies...)
	return nil
}

func (q *recordingQueue) snapshot() ([]string, []string, []string) {
	q.mu.Lock()
	defer q.mu.Unlock()
	return append([]string(nil), q.acks...), append([]string(nil), q.retries...), append([]string(nil), q.dlq...)
}

// scriptedHandler succeeds or fails per job type and records the peak number of
// concurrent invocations, which is how the concurrency cap is verified.
type scriptedHandler struct {
	mu       sync.Mutex
	seen     map[string]int
	fail     map[string]error
	inFlight int32
	peak     int32
	release  chan struct{}
}

// newScriptedHandler returns a handler that runs to completion immediately.
// Set release to a channel to hold handlers open (used by the concurrency test).
func newScriptedHandler(fail map[string]error) *scriptedHandler {
	return &scriptedHandler{seen: map[string]int{}, fail: fail}
}

func (h *scriptedHandler) Handle(_ context.Context, job *jobs.Job) error {
	cur := atomic.AddInt32(&h.inFlight, 1)
	for {
		peak := atomic.LoadInt32(&h.peak)
		if cur <= peak || atomic.CompareAndSwapInt32(&h.peak, peak, cur) {
			break
		}
	}
	if h.release != nil {
		<-h.release
	}
	atomic.AddInt32(&h.inFlight, -1)

	h.mu.Lock()
	h.seen[job.Type]++
	err := h.fail[job.Type]
	h.mu.Unlock()
	return err
}

func (h *scriptedHandler) count(jobType string) int {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.seen[jobType]
}

func newConsumer(t *testing.T, q *recordingQueue, h jobs.Handler, maxAttempts int) *Consumer {
	t.Helper()
	return New(Options{
		Queue:             q,
		Dispatcher:        jobs.NewDispatcher(map[string]jobs.Handler{jobs.TypePageDelete: h}),
		Concurrency:       10,
		BatchSize:         10,
		VisibilityTimeout: 30 * time.Second,
		PollInterval:      time.Millisecond,
		MaxAttempts:       maxAttempts,
	})
}

func msg(id, body string, attempts int) cloudflare.Message {
	return cloudflare.Message{ID: id, LeaseID: "lease-" + id, Body: body, Attempts: attempts}
}

const pageDeleteBody = `{"type":"page_delete","page_id":"p1","site_id":"s1"}`

// bodyWithPage builds a job the outcomeByJobHandler rejects.
func bodyWithPage(pageID string) string {
	return `{"type":"page_delete","page_id":"` + pageID + `","site_id":"s1"}`
}

func TestProcessBatchAcksSuccesses(t *testing.T) {
	h := newScriptedHandler(nil)
	c := newConsumer(t, nil, h, 3)

	acks, retries, dlq := c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", pageDeleteBody, 0),
		msg("m2", pageDeleteBody, 1),
	})

	if len(acks) != 2 || len(retries) != 0 || len(dlq) != 0 {
		t.Fatalf("acks=%v retries=%v dlq=%v, want 2/0/0", acks, retries, dlq)
	}
	if h.count(jobs.TypePageDelete) != 2 {
		t.Errorf("handler ran %d times, want 2", h.count(jobs.TypePageDelete))
	}
}

func TestProcessBatchRetriesFailures(t *testing.T) {
	boom := errors.New("boom")
	h := newScriptedHandler(map[string]error{jobs.TypePageDelete: boom})
	c := newConsumer(t, nil, h, 3)

	acks, retries, dlq := c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", pageDeleteBody, 0),
	})

	if len(acks) != 0 {
		t.Errorf("acks = %v, want none: a job must never be acked before it succeeds", acks)
	}
	if len(retries) != 1 || retries[0] != "lease-m1" {
		t.Errorf("retries = %v, want [lease-m1]", retries)
	}
	if len(dlq) != 0 {
		t.Errorf("dlq = %v, want none on the first failure", dlq)
	}
}

// A job that keeps failing must eventually reach the dead-letter queue instead
// of being retried forever.
func TestProcessBatchDeadLettersAfterMaxAttempts(t *testing.T) {
	boom := errors.New("boom")
	h := newScriptedHandler(map[string]error{jobs.TypePageDelete: boom})
	c := newConsumer(t, nil, h, 2)

	acks, retries, dlq := c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", pageDeleteBody, 0),
	})
	if len(retries) != 1 {
		t.Fatalf("first delivery: retries = %v, want 1", retries)
	}

	acks, retries, dlq = c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", pageDeleteBody, 0),
	})
	if len(acks) != 0 || len(retries) != 0 {
		t.Errorf("second delivery: acks=%v retries=%v, want none", acks, retries)
	}
	if len(dlq) != 1 || dlq[0] != pageDeleteBody {
		t.Errorf("dlq = %v, want the original job body", dlq)
	}
}

// Cloudflare's own delivery counter is the outer half of the retry budget, so a
// job that bounces between worker instances still dead-letters.
func TestProcessBatchDeadLettersOnDeliveryAttempts(t *testing.T) {
	boom := errors.New("boom")
	h := newScriptedHandler(map[string]error{jobs.TypePageDelete: boom})
	c := newConsumer(t, nil, h, 3)

	_, retries, dlq := c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", pageDeleteBody, 3),
	})

	if len(retries) != 0 {
		t.Errorf("retries = %v, want none once the delivery budget is spent", retries)
	}
	if len(dlq) != 1 {
		t.Errorf("dlq = %v, want 1", dlq)
	}
}

// A poison message can never be satisfied, so retrying it would wedge the queue
// behind it. It is acked and logged instead.
func TestProcessBatchAcksUnparseableBody(t *testing.T) {
	h := newScriptedHandler(nil)
	c := newConsumer(t, nil, h, 3)

	acks, retries, dlq := c.processBatch(context.Background(), []cloudflare.Message{
		msg("m1", "not json", 0),
		msg("m2", "", 0),
		msg("m3", `{"type":"unknown_job"}`, 0),
	})

	if len(acks) != 3 {
		t.Errorf("acks = %v, want all 3 poison messages acked", acks)
	}
	if len(retries) != 0 || len(dlq) != 0 {
		t.Errorf("retries=%v dlq=%v, want none", retries, dlq)
	}
	if h.count(jobs.TypePageDelete) != 0 {
		t.Error("the handler ran for an unparseable body")
	}
}

func TestProcessBatchMixesOutcomes(t *testing.T) {
	handler := &outcomeByJobHandler{}
	c := New(Options{
		Dispatcher:  jobs.NewDispatcher(map[string]jobs.Handler{jobs.TypePageDelete: handler}),
		Concurrency: 4,
		MaxAttempts: 5,
	})

	acks, retries, _ := c.processBatch(context.Background(), []cloudflare.Message{
		msg("ok1", pageDeleteBody, 0),
		msg("bad", bodyWithPage("p-bad"), 0),
		msg("ok2", pageDeleteBody, 0),
	})

	if len(acks) != 2 {
		t.Errorf("acks = %v, want 2", acks)
	}
	if len(retries) != 1 || retries[0] != "lease-bad" {
		t.Errorf("retries = %v, want [lease-bad]", retries)
	}
}

// outcomeByJobHandler fails the job whose page id is "p-bad".
type outcomeByJobHandler struct{}

func (outcomeByJobHandler) Handle(_ context.Context, job *jobs.Job) error {
	if job.PageID == "p-bad" {
		return errors.New("boom")
	}
	return nil
}

func TestProcessBatchRespectsConcurrency(t *testing.T) {
	h := newScriptedHandler(nil)
	h.release = make(chan struct{})
	c := New(Options{
		Dispatcher:  jobs.NewDispatcher(map[string]jobs.Handler{jobs.TypePageDelete: h}),
		Concurrency: 3,
		MaxAttempts: 2,
	})

	batch := make([]cloudflare.Message, 12)
	for i := range batch {
		batch[i] = msg(string(rune('a'+i)), pageDeleteBody, 0)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		c.processBatch(context.Background(), batch)
	}()

	// Let the goroutines reach the handler, then confirm no more than the cap
	// are inside it at once.
	time.Sleep(50 * time.Millisecond)
	if peak := atomic.LoadInt32(&h.peak); peak > 3 {
		t.Errorf("peak concurrency = %d, want <= 3", peak)
	}
	if peak := atomic.LoadInt32(&h.peak); peak < 2 {
		t.Errorf("peak concurrency = %d, want the batch to actually run in parallel", peak)
	}
	close(h.release)
	<-done
}

func TestPullAndProcessSettlesTheBatch(t *testing.T) {
	q := &recordingQueue{messages: []cloudflare.Message{
		msg("ok", pageDeleteBody, 0),
		msg("bad", bodyWithPage("p-bad"), 0),
	}}
	c := newConsumer(t, nil, &outcomeByJobHandler{}, 3)
	c.opts.Queue = q

	n, err := c.pullAndProcess(context.Background())
	if err != nil {
		t.Fatalf("pullAndProcess: %v", err)
	}
	if n != 2 {
		t.Errorf("handled %d messages, want 2", n)
	}

	acks, retries, dlq := q.snapshot()
	if len(acks) != 1 || acks[0] != "lease-ok" {
		t.Errorf("acks = %v, want [lease-ok]", acks)
	}
	if len(retries) != 1 || retries[0] != "lease-bad" {
		t.Errorf("retries = %v, want [lease-bad]", retries)
	}
	if len(dlq) != 0 {
		t.Errorf("dlq = %v, want none", dlq)
	}
}

func TestPullAndProcessPassesTheConfiguredWindow(t *testing.T) {
	q := &recordingQueue{}
	c := newConsumer(t, q, newScriptedHandler(nil), 3)
	c.opts.BatchSize = 7
	c.opts.VisibilityTimeout = 90 * time.Second

	if _, err := c.pullAndProcess(context.Background()); err != nil {
		t.Fatalf("pullAndProcess: %v", err)
	}

	q.mu.Lock()
	defer q.mu.Unlock()
	if q.lastBatch != 7 {
		t.Errorf("batch size = %d, want 7", q.lastBatch)
	}
	if q.lastVisibl != 90*time.Second {
		t.Errorf("visibility timeout = %s, want 90s", q.lastVisibl)
	}
}

func TestPullAndProcessDeadLetters(t *testing.T) {
	q := &recordingQueue{messages: []cloudflare.Message{
		msg("bad", bodyWithPage("p-bad"), 5),
	}}
	c := newConsumer(t, q, &outcomeByJobHandler{}, 3)

	if _, err := c.pullAndProcess(context.Background()); err != nil {
		t.Fatalf("pullAndProcess: %v", err)
	}

	acks, retries, dlq := q.snapshot()
	if len(acks) != 0 || len(retries) != 0 {
		t.Errorf("acks=%v retries=%v, want none", acks, retries)
	}
	// The DLQ copy must be the original body so the job can be replayed.
	if len(dlq) != 1 || dlq[0] != bodyWithPage("p-bad") {
		t.Errorf("dlq = %v, want the original body", dlq)
	}
}

// A pull failure must be reported so Run backs off, not silently swallowed.
func TestPullAndProcessPropagatesPullError(t *testing.T) {
	boom := errors.New("pull failed")
	q := &recordingQueue{pullErr: boom}
	c := newConsumer(t, q, newScriptedHandler(nil), 3)

	if _, err := c.pullAndProcess(context.Background()); !errors.Is(err, boom) {
		t.Fatalf("error = %v, want %v", err, boom)
	}
}

func TestRunStopsOnCancel(t *testing.T) {
	c := New(Options{
		Queue:        &recordingQueue{},
		Dispatcher:   jobs.NewDispatcher(map[string]jobs.Handler{}),
		Concurrency:  1,
		BatchSize:    1,
		PollInterval: time.Millisecond,
		MaxAttempts:  1,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 50*time.Millisecond)
	defer cancel()

	done := make(chan error, 1)
	go func() { done <- c.Run(ctx) }()

	select {
	case err := <-done:
		if err != nil {
			t.Fatalf("Run returned %v, want a clean shutdown", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("Run did not return after the context was cancelled")
	}
}
