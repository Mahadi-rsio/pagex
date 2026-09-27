import { and, isNull, type SQL } from "drizzle-orm";
import { pages } from "@/server/api/infrastructure/db/schema";

/**
 * Project visibility after the two-phase delete.
 *
 * `DELETE /api/pages/[id]` sets `pages.deleted_at` instead of removing the row,
 * because `deployments.page_id` is ON DELETE CASCADE and the background
 * `page_delete` job needs those rows to find the objects to purge. Every API
 * read path filters on this predicate, so a soft-deleted project is already
 * invisible: it cannot be listed, deployed to, or read usage for.
 *
 * The row (and its cascaded children) is hard-deleted by the worker in
 * `services/worker` once the purge succeeds.
 */
export function isLivePage(): SQL {
    return isNull(pages.deletedAt);
}

/** Combine the soft-delete filter with existing conditions. */
export function withLivePage(...conditions: Array<SQL | undefined>): SQL {
    return and(isLivePage(), ...conditions)!;
}
