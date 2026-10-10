import type { RepoRef } from "./build.validator";

/**
 * Resolve a branch (or ref) to an immutable commit SHA via the public GitHub
 * API. The build runner then checks out exactly this SHA, so a push that lands
 * mid-build can never change what gets deployed.
 *
 * Unauthenticated GitHub API calls are rate-limited per IP; a supplied
 * `GITHUB_TOKEN` raises that limit. No credentials are exposed to the build
 * itself — resolution happens in the console, and the runner clones anonymously.
 */

export interface GithubCommit {
    sha: string;
    message: string | null;
}

export type FetchLike = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

const SHA_RE = /^[0-9a-f]{7,40}$/i;

export function isLikelySha(ref: string): boolean {
    return SHA_RE.test(ref.trim());
}

export class GithubError extends Error {
    status: number;
    constructor(message: string, status: number) {
        super(message);
        this.name = "GithubError";
        this.status = status;
    }
}

/**
 * Resolve a repo ref to a commit. Returns `null` when GitHub reports the repo
 * or ref does not exist (404); throws `GithubError` for auth/rate-limit/5xx so
 * the caller can surface a 502 rather than a misleading 404.
 */
export async function resolveCommit(
    fetchImpl: FetchLike,
    repo: RepoRef,
    ref: string,
): Promise<GithubCommit | null> {
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/commits/${encodeURIComponent(
        ref,
    )}`;

    const headers: Record<string, string> = {
        accept: "application/vnd.github+json",
        "user-agent": "pagex-console",
        "x-github-api-version": "2022-11-28",
    };
    const token = process.env.GITHUB_TOKEN;
    if (token) headers.authorization = `Bearer ${token}`;

    const res = await fetchImpl(url, { headers });

    if (res.status === 404) return null;
    if (!res.ok) {
        throw new GithubError(
            `GitHub API returned ${res.status} resolving ${repo.owner}/${repo.repo}@${ref}`,
            502,
        );
    }

    const body = (await res.json()) as {
        sha?: unknown;
        commit?: { message?: unknown };
    };
    if (typeof body.sha !== "string") return null;

    const message =
        typeof body.commit?.message === "string"
            ? (body.commit.message.split("\n")[0]?.trim() ?? null)
            : null;

    return { sha: body.sha, message };
}
