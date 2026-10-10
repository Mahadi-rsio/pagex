/**
 * Legacy MinIO cleanup script (tenant/ → content-addressed blobs/).
 *
 * Console runtime storage now uses the Cloudflare R2 `BLOBS` binding.
 * This one-off migration script is obsolete for Workers deployments.
 * Use `wrangler r2 object` / the Cloudflare dashboard for bucket maintenance.
 */
console.error(
    "migrate-to-blob-serving.ts is obsolete: Console storage uses the R2 BLOBS binding.\n" +
        "Use Wrangler R2 commands for administrative object maintenance.",
);
process.exitCode = 1;
