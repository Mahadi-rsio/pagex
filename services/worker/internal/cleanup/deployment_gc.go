// Package cleanup implements the background job handlers.
//
// Both handlers are idempotent. Cloudflare Queues is an at-least-once queue, so
// every step is written to converge on the same end state whether it runs once
// or five times, and in any order relative to the rest of the batch.
package cleanup

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/lib/pq"

	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
	"github.com/Mahadi-rsio/pagex-worker/internal/storage"
)

// DeploymentGC prunes a page's deployment history and deletes the blobs that
// pruning orphans.
//
// This is the Go port of the console's former `runDeploymentGC()`. The console
// only enqueues it; nothing about a deployment depends on the outcome.
//
// Order of operations matters and is the same as the original:
//  1. Select inactive deployments beyond the retention window (active is never
//     a target, so the just-activated deployment is safe).
//  2. Collect their blob hashes.
//  3. Drop any hash still referenced by a surviving deployment.
//  4. Delete the MinIO objects first — only hashes the object store confirms
//     removed may have their `blobs` row deleted, so a partial S3 failure leaks
//     a row rather than orphaning an object.
//  5. Delete the immutable manifest objects, then the rows in one transaction.
type DeploymentGC struct {
	Store *storage.Store
	// Retention is how many recent deployments to keep per page.
	Retention int
}

// NewDeploymentGC builds the handler.
func NewDeploymentGC(store *storage.Store, retention int) *DeploymentGC {
	return &DeploymentGC{Store: store, Retention: retention}
}

// Handle prunes one page's history. Safe to call repeatedly.
func (h *DeploymentGC) Handle(ctx context.Context, job *jobs.Job) error {
	if job.Type != jobs.TypeDeploymentGC {
		return fmt.Errorf("deployment_gc handler received job type %q", job.Type)
	}

	expiredIDs, err := h.expiredDeployments(ctx, job.PageID)
	if err != nil {
		return fmt.Errorf("select expired deployments for page %s: %w", job.PageID, err)
	}
	if len(expiredIDs) == 0 {
		slog.Debug("deployment_gc: nothing to prune",
			"page_id", job.PageID, "deployment_id", job.DeploymentID)
		return nil
	}

	orphanedHashes, err := h.orphanedHashes(ctx, expiredIDs)
	if err != nil {
		return err
	}

	var deletedHashes []string
	if len(orphanedHashes) > 0 {
		// Object store first: only acknowledged deletions may drop their row.
		deletedHashes, err = h.Store.DeleteBlobHashes(ctx, orphanedHashes)
		if err != nil {
			return fmt.Errorf("delete blob objects: %w", err)
		}
	}

	if err := h.Store.DeleteManifestObjects(ctx, expiredIDs); err != nil {
		return fmt.Errorf("delete manifest objects: %w", err)
	}

	if err := h.deleteRows(ctx, expiredIDs, deletedHashes); err != nil {
		return err
	}

	slog.Info("deployment_gc complete",
		"page_id", job.PageID,
		"site_id", job.SiteID,
		"activated_deployment_id", job.DeploymentID,
		"deployments_removed", len(expiredIDs),
		"blobs_removed", len(deletedHashes))

	return nil
}

// expiredDeployments returns inactive deployments past the retention window,
// newest first. The active deployment is excluded by the is_active predicate.
func (h *DeploymentGC) expiredDeployments(ctx context.Context, pageID string) ([]string, error) {
	rows, err := h.Store.DB.QueryContext(ctx, `
		SELECT id
		FROM deployments
		WHERE page_id = $1 AND is_active = false
		ORDER BY created_at DESC
		OFFSET $2
	`, pageID, h.Retention)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// orphanedHashes returns the distinct blob hashes used only by the deployments
// about to be removed. A single `NOT EXISTS` keeps this to one round-trip
// instead of the two-step cross-check the console performed. Every
// blob_tree_entries row belongs to a live deployment (ON DELETE CASCADE), so no
// join is needed to know that.
func (h *DeploymentGC) orphanedHashes(ctx context.Context, expiredIDs []string) ([]string, error) {
	rows, err := h.Store.DB.QueryContext(ctx, `
		SELECT DISTINCT bte.blob_hash
		FROM blob_tree_entries bte
		WHERE bte.deployment_id = ANY($1)
		  AND NOT EXISTS (
			SELECT 1
			FROM blob_tree_entries other
			WHERE other.blob_hash = bte.blob_hash
			  AND NOT (other.deployment_id = ANY($1))
		  )
	`, pq.Array(expiredIDs))
	if err != nil {
		return nil, fmt.Errorf("select orphaned blob hashes: %w", err)
	}
	defer rows.Close()

	var hashes []string
	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, err
		}
		hashes = append(hashes, hash)
	}
	return hashes, rows.Err()
}

// deleteRows removes the pruned deployments, their tree entries, and the blob
// rows whose objects are confirmed gone — in one transaction so the metadata
// store never disagrees with itself.
func (h *DeploymentGC) deleteRows(ctx context.Context, deploymentIDs, deletedHashes []string) error {
	tx, err := h.Store.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM blob_tree_entries WHERE deployment_id = ANY($1)`,
		pq.Array(deploymentIDs),
	); err != nil {
		return fmt.Errorf("delete blob tree entries: %w", err)
	}

	if _, err := tx.ExecContext(ctx,
		`DELETE FROM deployments WHERE id = ANY($1)`,
		pq.Array(deploymentIDs),
	); err != nil {
		return fmt.Errorf("delete deployments: %w", err)
	}

	if len(deletedHashes) > 0 {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM blobs WHERE hash = ANY($1)`,
			pq.Array(deletedHashes),
		); err != nil {
			return fmt.Errorf("delete blobs: %w", err)
		}
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit gc transaction: %w", err)
	}
	return nil
}
