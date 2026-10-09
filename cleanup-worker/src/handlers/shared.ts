/** Outcome of a cleanup job handler invocation. */
export type HandlerResult =
    | { outcome: "completed"; detail: string }
    | { outcome: "skipped"; reason: string }
    | { outcome: "permanent-error"; reason: string };

/**
 * Cross-page orphan check: a candidate blob is only deleted when no deployment
 * outside the target set still references it. Blobs are content-addressed and
 * shared across pages, so this protects blobs still in use by live projects.
 */
export function computeOrphanedHashes(
    candidateHashes: readonly string[],
    stillReferencedHashes: readonly string[],
): string[] {
    const stillSet = new Set(stillReferencedHashes);
    return candidateHashes.filter((h) => !stillSet.has(h));
}
