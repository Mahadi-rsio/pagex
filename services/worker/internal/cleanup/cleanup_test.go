package cleanup

import (
	"context"
	"encoding/xml"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"

	"github.com/DATA-DOG/go-sqlmock"
	"github.com/aws/aws-sdk-go-v2/aws"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
	"github.com/lib/pq"

	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
	"github.com/Mahadi-rsio/pagex-worker/internal/storage"
)

// s3Stub stands in for MinIO/S3. It records which keys were deleted and can be
// told to fail specific keys or every key, so the "object store first" ordering
// and the partial-failure behaviour are both exercised.
type s3Stub struct {
	mu       sync.Mutex
	deleted  []string
	failKeys map[string]string
	failAll  bool
}

func (s *s3Stub) keys() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.deleted...)
}

type s3DeleteResult struct {
	XMLName xml.Name `xml:"DeleteResult"`
	XMLNS   string   `xml:"xmlns,attr"`
	Deleted []struct {
		Key string `xml:"Key"`
	} `xml:"Deleted"`
	Errors []struct {
		Key     string `xml:"Key"`
		Code    string `xml:"Code"`
		Message string `xml:"Message"`
	} `xml:"Error"`
}

func newTestStore(t *testing.T) (sqlmock.Sqlmock, *storage.Store, *s3Stub) {
	t.Helper()

	db, mock, err := sqlmock.New()
	if err != nil {
		t.Fatalf("sqlmock.New: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })

	stub := &s3Stub{failKeys: map[string]string{}}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)

		var req struct {
			Objects []struct {
				Key string `xml:"Key"`
			} `xml:"Object"`
		}
		_ = xml.Unmarshal(body, &req)

		result := s3DeleteResult{XMLNS: "http://s3.amazonaws.com/doc/2006-03-01/"}

		stub.mu.Lock()
		for _, o := range req.Objects {
			_, bad := stub.failKeys[o.Key]
			if bad || stub.failAll {
				code := "AccessDenied"
				if bad {
					code = stub.failKeys[o.Key]
				}
				result.Errors = append(result.Errors, struct {
					Key     string `xml:"Key"`
					Code    string `xml:"Code"`
					Message string `xml:"Message"`
				}{Key: o.Key, Code: code, Message: "stub failure"})
				continue
			}
			stub.deleted = append(stub.deleted, o.Key)
			result.Deleted = append(result.Deleted, struct {
				Key string `xml:"Key"`
			}{Key: o.Key})
		}
		stub.mu.Unlock()

		encoded, _ := xml.Marshal(result)
		w.Header().Set("content-type", "application/xml")
		_, _ = w.Write([]byte(xml.Header + string(encoded)))
	}))
	t.Cleanup(srv.Close)

	client := s3.New(s3.Options{
		Region:       "us-east-1",
		BaseEndpoint: aws.String(srv.URL),
		UsePathStyle: true,
		Credentials:  credentials.NewStaticCredentialsProvider("key", "secret", ""),
	})

	return mock, &storage.Store{
		DB:          db,
		S3:          client,
		Bucket:      "bucket",
		DeleteBatch: 100,
	}, stub
}

func rowsOf(cols []string, values ...string) *sqlmock.Rows {
	r := sqlmock.NewRows(cols)
	for _, v := range values {
		r.AddRow(v)
	}
	return r
}

// expectInventory wires the reads that run before anything is deleted.
func expectInventory(mock sqlmock.Sqlmock, deploymentIDs, hashes []string) {
	mock.ExpectQuery(`SELECT id FROM deployments WHERE site_id = \$1`).
		WithArgs("s1").
		WillReturnRows(rowsOf([]string{"id"}, deploymentIDs...))

	mock.ExpectQuery(`SELECT DISTINCT bte\.blob_hash`).
		WithArgs("s1").
		WillReturnRows(rowsOf([]string{"blob_hash"}, hashes...))
}

// expectIdentity wires the subdomain/domain lookups used for cache cleanup.
func expectIdentity(mock sqlmock.Sqlmock, subdomain, domain string) {
	site := sqlmock.NewRows([]string{"subdomain"})
	page := sqlmock.NewRows([]string{"domain"})
	if subdomain != "" {
		site.AddRow(subdomain)
	}
	if domain != "" {
		page.AddRow(domain)
	}
	mock.ExpectQuery(`SELECT subdomain FROM sites WHERE id = \$1`).WithArgs("s1").WillReturnRows(site)
	mock.ExpectQuery(`SELECT domain FROM pages WHERE id = \$1`).WithArgs("p1").WillReturnRows(page)
}

// expectPurgeTx wires the row deletions inside the purge transaction.
func expectPurgeTx(mock sqlmock.Sqlmock, deletedHashes []string) {
	mock.ExpectBegin()
	for _, q := range []string{
		`DELETE FROM blob_tree_entries`,
		`DELETE FROM deployments`,
		`DELETE FROM site_daily_stats`,
		`DELETE FROM service_metrics_hourly`,
		`DELETE FROM bandwidth_usage_hourly`,
	} {
		mock.ExpectExec(q).WithArgs("s1").WillReturnResult(sqlmock.NewResult(0, 0))
	}
	if deletedHashes != nil {
		mock.ExpectExec(`DELETE FROM blobs WHERE hash = ANY`).
			WithArgs(pq.Array(deletedHashes)).
			WillReturnResult(sqlmock.NewResult(0, int64(len(deletedHashes))))
	}
	mock.ExpectExec(`DELETE FROM pages WHERE id = \$1`).
		WithArgs("p1").WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()
}

func pageDeleteJob() *jobs.Job {
	return &jobs.Job{Type: jobs.TypePageDelete, PageID: "p1", SiteID: "s1"}
}

func TestPageDeleteHappyPath(t *testing.T) {
	mock, store, stub := newTestStore(t)
	expectIdentity(mock, "acme", "acme.pagex.dev")
	expectInventory(mock, []string{"d1", "d2"}, []string{"h1"})
	expectPurgeTx(mock, []string{"h1"})

	if err := NewPageDelete(store).Handle(context.Background(), pageDeleteJob()); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}

	deleted := stub.keys()
	for _, want := range []string{
		"manifests/d1.manifest.json",
		"manifests/d2.manifest.json",
		"blobs/h1",
	} {
		if !contains(deleted, want) {
			t.Errorf("object store is missing %q; deleted = %v", want, deleted)
		}
	}
}

// A page with no orphaned blob body must still have its manifests removed.
func TestPageDeleteRemovesManifestsWithoutBlobs(t *testing.T) {
	mock, store, stub := newTestStore(t)
	expectIdentity(mock, "acme", "")
	expectInventory(mock, []string{"d1"}, nil)
	expectPurgeTx(mock, nil)

	if err := NewPageDelete(store).Handle(context.Background(), pageDeleteJob()); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}

	deleted := stub.keys()
	if len(deleted) != 1 || deleted[0] != "manifests/d1.manifest.json" {
		t.Errorf("deleted = %v, want [manifests/d1.manifest.json]", deleted)
	}
}

// A blob the object store refused to delete must keep its `blobs` row, otherwise
// the metadata store would claim a file that still exists.
func TestPageDeleteKeepsRowForFailedBlobObject(t *testing.T) {
	mock, store, stub := newTestStore(t)
	stub.failKeys["blobs/h1"] = "AccessDenied"
	expectIdentity(mock, "acme", "")
	expectInventory(mock, []string{"d1"}, []string{"h1", "h2"})
	expectPurgeTx(mock, []string{"h2"})

	if err := NewPageDelete(store).Handle(context.Background(), pageDeleteJob()); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

// Nothing may be deleted from PostgreSQL before the object store is cleaned,
// because those rows are the only record of what to delete.
func TestPageDeleteDoesNotTouchTheDBWhenS3Fails(t *testing.T) {
	mock, store, stub := newTestStore(t)
	stub.failAll = true
	expectIdentity(mock, "acme", "")
	expectInventory(mock, []string{"d1"}, nil)

	err := NewPageDelete(store).Handle(context.Background(), pageDeleteJob())
	if err == nil {
		t.Fatal("Handle succeeded, want the S3 failure surfaced for a retry")
	}
	// No transaction was opened, so no row was deleted.
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unexpected SQL after an S3 failure: %v", err)
	}
}

// A re-delivery after a successful purge must succeed, not error.
func TestPageDeleteIsIdempotent(t *testing.T) {
	mock, store, _ := newTestStore(t)
	expectIdentity(mock, "", "")
	expectInventory(mock, nil, nil)
	expectPurgeTx(mock, nil)

	if err := NewPageDelete(store).Handle(context.Background(), pageDeleteJob()); err != nil {
		t.Fatalf("second Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

func TestPageDeleteRejectsWrongJobType(t *testing.T) {
	_, store, _ := newTestStore(t)

	err := NewPageDelete(store).Handle(context.Background(), &jobs.Job{Type: jobs.TypeDeploymentGC})
	if err == nil {
		t.Fatal("Handle accepted a deployment_gc job, want an error")
	}
	if !strings.Contains(err.Error(), "page_delete") {
		t.Errorf("error = %v, want it to name the handler", err)
	}
}

func TestDeploymentGCPrunesBeyondRetention(t *testing.T) {
	mock, store, _ := newTestStore(t)

	mock.ExpectQuery(`SELECT id\s+FROM deployments\s+WHERE page_id = \$1 AND is_active = false`).
		WithArgs("p1", 5).
		WillReturnRows(rowsOf([]string{"id"}, "d1", "d2"))

	mock.ExpectQuery(`SELECT DISTINCT bte\.blob_hash`).
		WithArgs(sqlmock.AnyArg()).
		WillReturnRows(rowsOf([]string{"blob_hash"}, "h1"))

	mock.ExpectBegin()
	mock.ExpectExec(`DELETE FROM blob_tree_entries`).WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`DELETE FROM deployments`).WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 2))
	mock.ExpectExec(`DELETE FROM blobs`).WithArgs(sqlmock.AnyArg()).
		WillReturnResult(sqlmock.NewResult(0, 1))
	mock.ExpectCommit()

	job := &jobs.Job{Type: jobs.TypeDeploymentGC, PageID: "p1", SiteID: "s1", DeploymentID: "d0"}
	if err := NewDeploymentGC(store, 5).Handle(context.Background(), job); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("unmet SQL expectations: %v", err)
	}
}

// The freshly activated deployment is never a GC target, and an empty result set
// short-circuits before any delete runs.
func TestDeploymentGCNoopWhenNothingExpired(t *testing.T) {
	mock, store, _ := newTestStore(t)

	mock.ExpectQuery(`SELECT id\s+FROM deployments`).
		WithArgs("p1", 5).
		WillReturnRows(sqlmock.NewRows([]string{"id"}))

	job := &jobs.Job{Type: jobs.TypeDeploymentGC, PageID: "p1", SiteID: "s1", DeploymentID: "d0"}
	if err := NewDeploymentGC(store, 5).Handle(context.Background(), job); err != nil {
		t.Fatalf("Handle: %v", err)
	}
	if err := mock.ExpectationsWereMet(); err != nil {
		t.Fatalf("a delete ran for an empty GC: %v", err)
	}
}

func TestDeploymentGCRejectsWrongJobType(t *testing.T) {
	_, store, _ := newTestStore(t)

	if err := NewDeploymentGC(store, 5).Handle(context.Background(), pageDeleteJob()); err == nil {
		t.Fatal("Handle accepted a page_delete job, want an error")
	}
}

func contains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}
