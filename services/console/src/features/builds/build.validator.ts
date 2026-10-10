import { z } from "zod";
import { MAX_BUILD_LOG_CHUNK_BYTES } from "@/server/api/constants";

/**
 * Repository reference parsing for remote builds.
 *
 * Only public HTTPS clone URLs are accepted: the build runner clones without
 * credentials, so a tokenised URL (`https://user:pass@github.com/...`) or an
 * `ssh://` URL would either leak a secret into the build log or fail to clone.
 * The parsed `cloneUrl` is what the runner actually passes to `git`.
 */

export interface RepoRef {
    provider: "github";
    owner: string;
    repo: string;
    /** Canonical display URL, e.g. https://github.com/owner/repo */
    url: string;
    /** Value handed to `git clone`, e.g. https://github.com/owner/repo.git */
    cloneUrl: string;
}

const SEGMENT = /^[A-Za-z0-9_.-]+$/;

/**
 * Parse and normalise a repository reference. Returns `null` when the input is
 * not a recognised public GitHub repository.
 */
export function parseRepoUrl(input: string): RepoRef | null {
    const raw = input.trim();
    if (raw.length === 0 || raw.length > 512) return null;

    let owner: string | undefined;
    let repo: string | undefined;

    const shorthand = /^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/;
    const https = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/;

    const shorthandMatch = raw.match(shorthand);
    const httpsMatch = raw.match(https);

    if (httpsMatch) {
        owner = httpsMatch[1];
        repo = httpsMatch[2];
    } else if (shorthandMatch && !raw.includes("://") && !raw.includes("@")) {
        owner = shorthandMatch[1];
        repo = shorthandMatch[2];
    }

    if (!owner || !repo) return null;
    if (owner === "." || owner === ".." || repo === "." || repo === "..") {
        return null;
    }
    if (!SEGMENT.test(owner) || !SEGMENT.test(repo)) return null;

    return {
        provider: "github",
        owner,
        repo,
        url: `https://github.com/${owner}/${repo}`,
        cloneUrl: `https://github.com/${owner}/${repo}.git`,
    };
}

const repoUrlSchema = z
    .string()
    .min(1)
    .max(512)
    .refine(
        (v) => parseRepoUrl(v) !== null,
        "must be a public GitHub repository",
    );

const branchSchema = z
    .string()
    .min(1)
    .max(255)
    .regex(
        /^[A-Za-z0-9._\/-]+$/,
        "branch may only contain letters, numbers, '.', '_', '/' and '-'",
    )
    .refine((v) => !v.startsWith("-"), "branch may not start with '-'")
    .refine((v) => !v.includes(".."), "branch may not contain '..'");

export const createBuildSchema = z.object({
    pageId: z.string().uuid(),
    repoUrl: repoUrlSchema,
    branch: branchSchema.optional(),
    framework: z.string().min(1).max(64).optional(),
    buildCommand: z.string().min(1).max(500).optional(),
    outputDir: z
        .string()
        .min(1)
        .max(255)
        .regex(/^[A-Za-z0-9._\/-]+$/, "invalid output directory")
        .refine(
            (v) => !v.startsWith("/") && !v.includes(".."),
            "output dir must be a relative path",
        )
        .optional(),
});

export const claimBuildsSchema = z.object({
    workerId: z.string().min(1).max(128),
});

export const appendBuildLogSchema = z.object({
    workerId: z.string().min(1).max(128),
    chunk: z.string().min(1).max(MAX_BUILD_LOG_CHUNK_BYTES),
    /** Optional stage transition reported alongside a log chunk. */
    stage: z
        .enum(["cloning", "installing", "building", "deploying", "ready"])
        .optional(),
});

export const heartbeatBuildSchema = z.object({
    workerId: z.string().min(1).max(128),
});

export const completeBuildSchema = z.object({
    workerId: z.string().min(1).max(128),
    status: z.enum(["completed", "failed"]),
    deploymentId: z.string().uuid().optional(),
    error: z.string().max(4_000).optional(),
    stage: z
        .enum(["cloning", "installing", "building", "deploying", "ready"])
        .optional(),
});

export type CreateBuildInput = z.infer<typeof createBuildSchema>;
export type ClaimBuildsInput = z.infer<typeof claimBuildsSchema>;
export type AppendBuildLogInput = z.infer<typeof appendBuildLogSchema>;
export type CompleteBuildInput = z.infer<typeof completeBuildSchema>;
