package jobs

import (
	"context"
	"errors"
	"testing"
)

func TestParseDeploymentGC(t *testing.T) {
	body := `{"type":"deployment_gc","page_id":"p1","site_id":"s1","deployment_id":"d1"}`

	job, err := Parse(body)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if job.Type != TypeDeploymentGC {
		t.Errorf("Type = %q, want %q", job.Type, TypeDeploymentGC)
	}
	if job.PageID != "p1" || job.SiteID != "s1" || job.DeploymentID != "d1" {
		t.Errorf("ids = %+v", job)
	}
	if job.RawBody != body {
		t.Errorf("RawBody = %q, want the trimmed original", job.RawBody)
	}
}

func TestParsePageDelete(t *testing.T) {
	job, err := Parse(`{"type":"page_delete","page_id":"p1","site_id":"s1"}`)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if job.Type != TypePageDelete {
		t.Errorf("Type = %q, want %q", job.Type, TypePageDelete)
	}
	if job.PageID != "p1" || job.SiteID != "s1" {
		t.Errorf("ids = %+v", job)
	}
	if job.DeploymentID != "" {
		t.Errorf("DeploymentID = %q, want empty for page_delete", job.DeploymentID)
	}
}

// The console always publishes a JSON string as the message body, so the worker
// must unwrap one level of stringification.
func TestParseDoubledEncodedBody(t *testing.T) {
	inner := `{\"type\":\"page_delete\",\"page_id\":\"p1\",\"site_id\":\"s1\"}`
	job, err := Parse(`"` + inner + `"`)
	if err != nil {
		t.Fatalf("Parse: %v", err)
	}
	if job.PageID != "p1" {
		t.Errorf("PageID = %q, want p1", job.PageID)
	}
}

func TestParseRejects(t *testing.T) {
	cases := map[string]string{
		"empty":                "",
		"whitespace":           "   ",
		"malformed json":       `{"type":`,
		"unknown type":         `{"type":"nope","page_id":"p"}`,
		"missing page id":      `{"type":"page_delete","site_id":"s1"}`,
		"missing site id":      `{"type":"page_delete","page_id":"p1"}`,
		"gc missing deploy id": `{"type":"deployment_gc","page_id":"p1","site_id":"s1"}`,
	}
	for name, body := range cases {
		t.Run(name, func(t *testing.T) {
			if _, err := Parse(body); err == nil {
				t.Fatalf("Parse(%q) succeeded, want an error", body)
			}
		})
	}
}

type stubHandler struct {
	called int
	err    error
}

func (s *stubHandler) Handle(_ context.Context, job *Job) error {
	s.called++
	return s.err
}

func TestDispatch(t *testing.T) {
	gc := &stubHandler{}
	del := &stubHandler{}
	d := NewDispatcher(map[string]Handler{
		TypeDeploymentGC: gc,
		TypePageDelete:   del,
	})

	if err := d.Dispatch(t.Context(), &Job{Type: TypePageDelete}); err != nil {
		t.Fatalf("Dispatch: %v", err)
	}
	if del.called != 1 || gc.called != 0 {
		t.Errorf("routed to the wrong handler: page_delete=%d gc=%d", del.called, gc.called)
	}
}

func TestDispatchPropagatesHandlerError(t *testing.T) {
	sentinel := errors.New("boom")
	h := &stubHandler{err: sentinel}
	d := NewDispatcher(map[string]Handler{TypePageDelete: h})

	err := d.Dispatch(t.Context(), &Job{Type: TypePageDelete})
	if !errors.Is(err, sentinel) {
		t.Fatalf("Dispatch error = %v, want the handler error", err)
	}
}

func TestDispatchUnknownTypeIsAnError(t *testing.T) {
	d := NewDispatcher(map[string]Handler{TypePageDelete: &stubHandler{}})

	if err := d.Dispatch(t.Context(), &Job{Type: "nope"}); err == nil {
		t.Fatal("Dispatch succeeded for an unregistered type, want an error")
	}
}
