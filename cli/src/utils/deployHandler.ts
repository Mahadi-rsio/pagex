import fs from "fs";
import path from "path";
import { createHash } from "crypto";
import pLimit from "p-limit";
import { config } from "../config.js";
import { logger } from "./logger.js";
import { ConfigError, NetworkError } from "./errors.js";
import { formatBytes } from "./formatBytes.js";
import {
    validateManifest,
    type ManifestEntry,
} from "./validateManifest.js";
import {
    prepareDeploy,
    presignUploads,
    putPresigned,
    commitDeploy,
    type PrepareResponse,
    type PrepareSummary,
    type CommitResponse,
} from "../api/deployApi.js";

/** Extensions produced server-side at commit — never include in the CLI manifest. */
const SERVER_VARIANT_RE = /\.(br|gz|webp)$/i;

interface LocalFile extends ManifestEntry {
    absolutePath: string;
}

function human(
    humanField: string | undefined,
    bytes: number | undefined,
): string {
    if (humanField && humanField.trim()) return humanField;
    return formatBytes(bytes ?? 0);
}

/**
 * Recursively collect files from the build output directory.
 * Paths are relative POSIX paths from the build root.
 * Hashes are lowercase SHA256 hex (required by the API).
 */
function collectBuildFiles(buildPath: string): LocalFile[] {
    const results: LocalFile[] = [];

    const walk = (dir: string): void => {
        for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
            const absolutePath = path.join(dir, entry.name);

            if (entry.isDirectory()) {
                walk(absolutePath);
                continue;
            }
            if (!entry.isFile()) continue;

            const rel = path.relative(buildPath, absolutePath).split(path.sep).join("/");
            if (SERVER_VARIANT_RE.test(rel)) continue;

            const base = path.posix.basename(rel);
            if (base === ".env" || base.startsWith(".env.")) continue;

            const buf = fs.readFileSync(absolutePath);
            const hash = createHash("sha256").update(buf).digest("hex"); // lowercase
            const magicBytes = buf.subarray(0, Math.min(16, buf.length)).toString("base64");

            results.push({
                path: rel,
                hash,
                size: buf.length,
                magicBytes,
                absolutePath,
            });
        }
    };

    walk(buildPath);
    return results;
}

function printPrepareSummary(
    summary: PrepareSummary,
    prep: Pick<PrepareResponse, "filesToUpload" | "filesReused" | "expiresIn">,
): void {
    const total = human(summary.totalSizeHuman, summary.totalSize);
    const upload = human(summary.uploadSizeHuman, summary.uploadSize);
    const reused = formatBytes(summary.reusedSize);

    logger.info(`${summary.totalFiles} files · ${total} total`);
    logger.info(
        `Upload ${upload} (${prep.filesToUpload} new) · reuse ${reused} (${prep.filesReused} blobs)`,
    );
    if (typeof prep.expiresIn === "number") {
        logger.verbose(`Deployment token expires in ${prep.expiresIn}s`);
    }
}

function printCommitSummary(result: CommitResponse): void {
    const { summary, filesDeployed, filesReused, deployment } = result;
    const version = deployment?.version;
    const title =
        version !== undefined && version !== null && `${version}` !== ""
            ? `Deployed v${version}`
            : "Deployed successfully";

    logger.success(title);

    const total = human(summary.totalSizeHuman, summary.totalSize);
    logger.info(`  ${summary.totalFiles} files · ${total} total`);

    if (summary.filesCompressed > 0 || summary.sizeReduced > 0) {
        const saved = human(summary.sizeReducedHuman, summary.sizeReduced);
        const pct =
            typeof summary.sizeReducedPercent === "number"
                ? ` (${summary.sizeReducedPercent}%)`
                : "";
        logger.info(`  Text saved ${saved}${pct}`);
    }

    if (summary.imagesOptimized > 0) {
        const imgSaved = human(
            summary.imageSizeReducedHuman,
            summary.imageSizeReduced,
        );
        logger.info(
            `  ${summary.imagesOptimized} image${summary.imagesOptimized === 1 ? "" : "s"} optimized (−${imgSaved})`,
        );
    }

    const liveCount = summary.deployedFiles ?? deployment?.file_count;
    if (typeof liveCount === "number") {
        logger.info(`  ${liveCount} files live (incl. .br/.gz/.webp)`);
    }

    logger.info(`  Blobs: ${filesDeployed} new, ${filesReused} reused`);
}

async function uploadRequiredBlobs(
    uploadRequired: PrepareResponse["uploadRequired"],
    files: LocalFile[],
    deploymentToken: string,
): Promise<void> {
    if (!uploadRequired || uploadRequired.length === 0) {
        logger.info("All blobs reused — skipping upload");
        return;
    }

    const byHash = new Map<string, LocalFile>();
    for (const f of files) {
        if (!byHash.has(f.hash)) byHash.set(f.hash, f);
    }

    // Unique hashes (identical files share one blob)
    const hashes = [...new Set(uploadRequired.map((f) => f.hash))];

    const missing = hashes.filter((h) => !byHash.has(h));
    if (missing.length > 0) {
        throw new ConfigError(
            `Prepare requested unknown hashes to upload (${missing.length}). Re-run deploy.`,
        );
    }

    const spinner = logger.spinner(`Presigning ${hashes.length} upload(s)...`).start();
    let urls;
    try {
        urls = await presignUploads({ deploymentToken, hashes });
        spinner.succeed(`Presigned ${urls.length} upload(s)`);
    } catch (err) {
        spinner.fail("Presign failed");
        throw err;
    }

    if (urls.length === 0) {
        throw new NetworkError("Presign returned no upload URLs");
    }

    const limit = pLimit(5);
    let done = 0;
    const total = urls.length;
    const uploadSpinner = logger.spinner(`Uploading 0/${total}...`).start();

    try {
        await Promise.all(
            urls.map((item) =>
                limit(async () => {
                    const local = byHash.get(item.hash);
                    if (!local) {
                        throw new ConfigError(`No local file for hash ${item.hash}`);
                    }
                    const body = fs.readFileSync(local.absolutePath);
                    await putPresigned(item.url, body);
                    done += 1;
                    uploadSpinner.text = `Uploading ${done}/${total}...`;
                }),
            ),
        );
        uploadSpinner.succeed(`Uploaded ${total} blob(s)`);
    } catch (err) {
        uploadSpinner.fail("Upload failed");
        throw err;
    }
}

/**
 * Deploy build output via prepare → presign → PUT → commit.
 * CLI uploads original files only; compression and WebP run server-side at commit.
 */
export async function deploy(projectPath: string, pageId: string) {
    const buildPath = config.BUILD_DIRS
        .map((d) => path.join(projectPath, d))
        .find((p) => fs.existsSync(p));

    if (!buildPath) {
        throw new ConfigError(
            `No build folder found (checked: ${config.BUILD_DIRS.join(", ")})`,
        );
    }

    if (!pageId) {
        throw new ConfigError(
            "No project linked. Run `pagex init` first (need page id or project_name).",
        );
    }

    // 1. Collect + hash
    const collectSpinner = logger
        .spinner(`Scanning ${path.basename(buildPath)}...`)
        .start();
    let files: LocalFile[];
    try {
        files = collectBuildFiles(buildPath);
        collectSpinner.succeed(`Found ${files.length} file(s) in ${path.basename(buildPath)}`);
    } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        collectSpinner.fail(`Scan failed: ${msg}`);
        throw err;
    }

    if (files.length === 0) {
        throw new ConfigError("Build folder is empty — nothing to deploy.");
    }

    // 2. Local validation (fail fast before prepare)
    validateManifest(files);

    const manifest = files.map(({ path: p, hash, size, magicBytes }) => ({
        path: p,
        hash,
        size,
        magicBytes,
    }));

    // 3. Prepare
    const prepSpinner = logger.spinner("Preparing deployment...").start();
    let prep: PrepareResponse;
    try {
        prep = await prepareDeploy({ pageId, files: manifest });
        prepSpinner.succeed("Prepare complete");
    } catch (err) {
        prepSpinner.fail("Prepare failed");
        throw err;
    }

    printPrepareSummary(prep.summary, prep);

    logger.verbose(
        `Token acquired; ${prep.uploadRequired.length} file(s) / ` +
            `${prep.filesToUpload} blob(s) to upload (TTL ${prep.expiresIn ?? 600}s)`,
    );

    // 4. Presign + PUT originals only (within token TTL)
    await uploadRequiredBlobs(prep.uploadRequired, files, prep.deploymentToken);

    // 5. Commit (server optimizes: Brotli/Gzip/WebP)
    const commitSpinner = logger
        .spinner("Committing deployment (server optimizing assets)...")
        .start();
    let result: CommitResponse;
    try {
        result = await commitDeploy(prep.deploymentToken);
        commitSpinner.stop();
    } catch (err) {
        commitSpinner.fail("Commit failed");
        throw err;
    }

    if (!result.success) {
        throw new NetworkError("Deploy commit did not succeed");
    }

    printCommitSummary(result);
}
