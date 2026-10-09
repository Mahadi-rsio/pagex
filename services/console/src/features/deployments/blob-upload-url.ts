/**
 * Build the Worker-mediated blob upload URL for a single hash.
 *
 * The URL is always derived from the live request origin — never from build
 * env — so a local-preview `PUBLIC_URL` (e.g. `http://127.0.0.1:8787`) can
 * never be baked into a production build and handed to the CLI. Kept in its
 * own module so it can be unit-tested without importing the deploy service's
 * DB/Redis/R2 dependencies.
 */
export function buildBlobUploadUrl(
    baseUrl: string,
    deploymentToken: string,
    hash: string,
): string {
    const params = new URLSearchParams({
        token: deploymentToken,
        hash,
    });
    return `${baseUrl.replace(/\/+$/, "")}/api/deploy/blob?${params.toString()}`;
}
