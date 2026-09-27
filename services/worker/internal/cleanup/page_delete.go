package cleanup

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/lib/pq"

	"github.com/Mahadi-rsio/pagex-worker/internal/jobs"
	"github.com/Mahadi-rsio/pagex-worker/internal/storage"
)

// PageDelete purges a soft-deleted project.
//
// The console has already made the project invisible and unservable by the time
// this runs (pages.deleted_at set, sites.active = false, deploy lock fenced), so
// this handler owns the asynchronous remainder:
//
//  1. Collect the site's deployment IDs and the blob hashes only it references.
//  2. Delete the MinIO manifest objects, then the blob objects.
//  3. Delete deployments, blob references, usage aggregates and the soft-deleted
//     page row (which cascades idempotency keys).
//  4. Drop any remaining cached state for the site (best effort).
//
// Idempotency: every step is a no-op when its target is already gone, so a
// duplicate or retried delivery converges on the same end state. Blobs shared
// with another project are never removed, because hash selection excludes
// anything another site still references.
//
// The `sites` row is intentionally left in place (deactivated), matching the
// console's delete semantics and keeping the subdomain permanently reserved.
type PageDelete struct {
	Store *storage.Store
}

// NewPageDelete builds the handler.
func NewPageDelete(store *storage.Store) *PageDelete {
	return &PageDelete{Store: store}
}

// Handle purges one deleted project.
func (h *PageDelete) Handle(ctx context.Context, job *jobs.Job) error {
	if job.Type != jobs.TypePageDelete {
		return fmt.Errorf("page_delete handler received job type %q", job.Type)
	}

	// Read the routing identity before the rows disappear: the cached keys are
	// named after the subdomain and domain, not the site ID.
	identity := h.identity(ctx, job)

	deploymentIDs, hashes, err := h.inventory(ctx, job.SiteID)
	if err != nil {
		return err
	}

	// Object store before metadata: those rows are the only record of what must
	// be removed, so nothing is deleted from PostgreSQL until the objects are
	// gone. Crashing in between leaves orphaned objects that a redelivery picks
	// up, which is the safe direction to fail.
	if err := h.Store.DeleteManifestObjects(ctx, deploymentIDs); err != nil {
		return fmt.Errorf("delete manifest objects: %w", err)
	}

	deletedHashes, err := h.Store.DeleteBlobHashes(ctx, hashes)
	if err != nil {
		return fmt.Errorf("delete blob objects: %w", err)
	}

	if err := h.purgeRows(ctx, job, deletedHashes); err != nil {
		return err
	}

	// Cached state. PostgreSQL is already authoritative and the blob-server
	// rebuilds from it, so a Redis failure is logged rather than retried.
	h.clearCache(ctx, job, identity, deploymentIDs)

	slog.Info("page_delete complete",
		"page_id", job.PageID,
		"site_id", job.SiteID,
		"deployments_removed", len(deploymentIDs),
		"blobs_removed", len(deletedHashes))

	return nil
}

// routingIdentity holds the human-readable names the Redis keys are built from.
type routingIdentity struct {
	Subdomain string
	Domain    string
}

// identity reads the subdomain and domain needed to purge cached keys. A missing
// row is not an error: it just means a previous delivery already deleted them.
func (h *PageDelete) identity(ctx context.Context, job *jobs.Job) routingIdentity {
	var ident routingIdentity

	if err := h.Store.DB.QueryRowContext(ctx,
		`SELECT subdomain FROM sites WHERE id = $1`, job.SiteID,
	).Scan(&ident.Subdomain); err != nil {
		slog.Debug("page_delete: no site row for cache cleanup", "site_id", job.SiteID, "error", err)
	}

	if err := h.Store.DB.QueryRowContext(ctx,
		`SELECT domain FROM pages WHERE id = $1`, job.PageID,
	).Scan(&ident.Domain); err != nil {
		slog.Debug("page_delete: no page row for cache cleanup", "page_id", job.PageID, "error", err)
	}

	return ident
}

// inventory returns the site's deployment IDs and the blob hashes that only
// this site references.
func (h *PageDelete) inventory(ctx context.Context, siteID string) (deploymentIDs, hashes []string, err error) {
	rows, err := h.Store.DB.QueryContext(ctx,
		`SELECT id FROM deployments WHERE site_id = $1`, siteID)
	if err != nil {
		return nil, nil, fmt.Errorf("select deployments for site %s: %w", siteID, err)
	}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return nil, nil, err
		}
		deploymentIDs = append(deploymentIDs, id)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return nil, nil, err
	}
	rows.Close()

	// A hash shared with another site is left alone so the surviving project
	// keeps working.
	rows, err = h.Store.DB.QueryContext(ctx, `
		SELECT DISTINCT bte.blob_hash
		FROM blob_tree_entries bte
		JOIN deployments d ON d.id = bte.deployment_id
		WHERE d.site_id = $1
		  AND NOT EXISTS (
			SELECT 1
			FROM blob_tree_entries other
			JOIN deployments other_dep ON other_dep.id = other.deployment_id
			WHERE other.blob_hash = bte.blob_hash
			  AND other_dep.site_id <> $1
		  )
	`, siteID)
	if err != nil {
		return nil, nil, fmt.Errorf("select blob hashes for site %s: %w", siteID, err)
	}
	defer rows.Close()

	for rows.Next() {
		var hash string
		if err := rows.Scan(&hash); err != nil {
			return nil, nil, err
		}
		hashes = append(hashes, hash)
	}
	return deploymentIDs, hashes, rows.Err()
}

// purgeRows removes the site's deployments, blob references and usage
// aggregates, then the soft-deleted page row. Everything runs in one
// transaction so a partial purge can never leave a deployment row without its
// object or vice versa.
func (h *PageDelete) purgeRows(ctx context.Context, job *jobs.Job, deletedHashes []string) error {
	tx, err := h.Store.DB.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin purge transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	statements := []string{
		`DELETE FROM blob_tree_entries WHERE deployment_id IN (SELECT id FROM deployments WHERE site_id = $1)`,
		`DELETE FROM deployments WHERE site_id = $1`,
		`DELETE FROM site_daily_stats WHERE site_id = $1`,
		`DELETE FROM service_metrics_hourly WHERE site_id = $1`,
		`DELETE FROM bandwidth_usage_hourly WHERE site_id = $1`,
	}
	for _, stmt := range statements {
		if _, err := tx.ExecContext(ctx, stmt, job.SiteID); err != nil {
			return fmt.Errorf("purge %q: %w", stmt, err)
		}
	}

	if len(deletedHashes) > 0 {
		// A concurrent deploy that started referencing one of these hashes
		// between selection and here trips the blob_tree_entries → blobs foreign
		// key. That aborts the transaction and the job is retried, which is the
		// correct outcome: a shared blob is never destroyed.
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM blobs WHERE hash = ANY($1)`,
			pq.Array(deletedHashes),
		); err != nil {
			return fmt.Errorf("delete blob rows: %w", err)
		}
	}

	// Cascades idempotency_keys.
	if _, err := tx.ExecContext(ctx,
		`DELETE FROM pages WHERE id = $1`, job.PageID); err != nil {
		return fmt.Errorf("delete page row: %w", err)
	}

	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit purge transaction: %w", err)
	}
	return nil
}

// clearCache drops cached state for the purged site. Best effort by design:
// PostgreSQL is authoritative and the blob-server repairs a missing key on the
// next miss.
//
// Key names mirror the blob-server's routing helpers and the console's
// redisKey() namespace, so they must stay byte-for-byte identical.
func (h *PageDelete) clearCache(ctx context.Context, job *jobs.Job, ident routingIdentity, deploymentIDs []string) {
	if h.Store.Redis == nil {
		return
	}

	keys := []string{
		"site:" + job.SiteID + ":active",
		"site_version:" + job.SiteID,
		"site_files:" + job.SiteID, // legacy hash, still written by older deploys
	}
	if ident.Subdomain != "" {
		keys = append(keys, "site:subdomain:"+ident.Subdomain)
	}
	if ident.Domain != "" {
		keys = append(keys,
			"db_cache:"+ident.Domain,
			"requests:"+ident.Domain,
			"bandwidth:"+ident.Domain,
		)
	}
	for _, id := range deploymentIDs {
		keys = append(keys, "manifest:"+id)
	}

	if err := h.Store.Redis.DelKeys(ctx, keys...); err != nil {
		slog.Warn("page_delete: redis key cleanup failed; PostgreSQL remains authoritative",
			"site_id", job.SiteID, "error", err)
	}

	// Unique-visitor counters are date-stamped, so they need a pattern sweep.
	if err := h.Store.Redis.DelPattern(ctx, "uniq:"+job.SiteID+":*"); err != nil {
		slog.Warn("page_delete: redis pattern cleanup failed; PostgreSQL remains authoritative",
			"site_id", job.SiteID, "error", err)
	}
}
