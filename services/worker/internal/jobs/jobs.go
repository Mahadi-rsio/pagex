// Package jobs defines the background job contract shared with the console's
// producer (services/console/src/server/api/queues/background-job.ts).
//
// Two job types exist, and only cleanup work is ever queued:
//
//	{"type":"deployment_gc","page_id":"…","site_id":"…","deployment_id":"…"}
//	{"type":"page_delete","page_id":"…","site_id":"…"}
//
// Deployments themselves stay synchronous end to end (upload → Brotli/Gzip →
// commit → manifest → activation → Redis). Every handler must be idempotent:
// Cloudflare Queues is at-least-once, so a message can be delivered more than
// once, and a lease that is never settled is redelivered after the visibility
// timeout.
package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

const (
	TypeDeploymentGC = "deployment_gc"
	TypePageDelete   = "page_delete"
)

// DeploymentGC prunes a page's deployment history and the blobs it orphans.
type DeploymentGC struct {
	Type         string `json:"type"`
	PageID       string `json:"page_id"`
	SiteID       string `json:"site_id"`
	DeploymentID string `json:"deployment_id"`
}

// PageDelete purges every remaining trace of a deleted project: deployments,
// blob references, manifests, MinIO objects, and cached runtime state.
type PageDelete struct {
	Type   string `json:"type"`
	PageID string `json:"page_id"`
	SiteID string `json:"site_id"`
}

// Job is a parsed, validated background job.
type Job struct {
	Type         string
	PageID       string
	SiteID       string
	DeploymentID string
	RawBody      string
	Attempts     int
	MessageID    string
	MessageLease string
}

// Parse validates an untrusted queue body.
//
// The console publishes `{"messages":[{"body":"<job json>"}]}`, so `body` is
// normally the job JSON itself. A body that is itself a JSON string is unwrapped
// once, so a producer that sends the object rather than a serialized string is
// tolerated too.
//
// An unrecognised body is NOT retryable — retrying it forever would wedge the
// queue — so Parse returns an error the consumer logs and ACKs.
func Parse(body string) (*Job, error) {
	trimmed := strings.TrimSpace(body)
	if trimmed == "" {
		return nil, fmt.Errorf("empty message body")
	}

	if unwrapped, ok := unwrapString(trimmed); ok {
		trimmed = unwrapped
		if trimmed == "" {
			return nil, fmt.Errorf("empty message body")
		}
	}

	var probe struct {
		Type string `json:"type"`
	}
	if err := json.Unmarshal([]byte(trimmed), &probe); err != nil {
		return nil, fmt.Errorf("malformed JSON body: %w", err)
	}

	switch probe.Type {
	case TypeDeploymentGC:
		var j DeploymentGC
		if err := json.Unmarshal([]byte(trimmed), &j); err != nil {
			return nil, fmt.Errorf("malformed %s body: %w", TypeDeploymentGC, err)
		}
		if j.PageID == "" || j.SiteID == "" || j.DeploymentID == "" {
			return nil, fmt.Errorf("%s requires page_id, site_id and deployment_id", TypeDeploymentGC)
		}
		return &Job{
			Type:         TypeDeploymentGC,
			PageID:       j.PageID,
			SiteID:       j.SiteID,
			DeploymentID: j.DeploymentID,
			RawBody:      trimmed,
		}, nil

	case TypePageDelete:
		var j PageDelete
		if err := json.Unmarshal([]byte(trimmed), &j); err != nil {
			return nil, fmt.Errorf("malformed %s body: %w", TypePageDelete, err)
		}
		if j.PageID == "" || j.SiteID == "" {
			return nil, fmt.Errorf("%s requires page_id and site_id", TypePageDelete)
		}
		return &Job{
			Type:    TypePageDelete,
			PageID:  j.PageID,
			SiteID:  j.SiteID,
			RawBody: trimmed,
		}, nil

	default:
		return nil, fmt.Errorf("unknown job type %q", probe.Type)
	}
}

// unwrapString reports whether body is a bare JSON string and returns its
// contents. The second return value is false for any other JSON value.
func unwrapString(body string) (string, bool) {
	if len(body) == 0 || body[0] != '"' {
		return "", false
	}
	var inner string
	if err := json.Unmarshal([]byte(body), &inner); err != nil {
		return "", false
	}
	return strings.TrimSpace(inner), true
}

// Handler processes one job type. It must be idempotent and must return an
// error only when the job is worth retrying.
type Handler interface {
	Handle(ctx context.Context, job *Job) error
}

// Dispatcher routes a parsed job to its handler.
type Dispatcher struct {
	handlers map[string]Handler
}

// NewDispatcher builds a dispatcher from type → handler mappings.
func NewDispatcher(handlers map[string]Handler) *Dispatcher {
	return &Dispatcher{handlers: handlers}
}

// Dispatch invokes the handler registered for the job's type.
func (d *Dispatcher) Dispatch(ctx context.Context, job *Job) error {
	handler, ok := d.handlers[job.Type]
	if !ok {
		return fmt.Errorf("no handler registered for job type %q", job.Type)
	}
	return handler.Handle(ctx, job)
}
