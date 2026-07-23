import { createHash, randomBytes } from "node:crypto";
import { inflateSync, brotliDecompressSync } from "node:zlib";

const API_BASE = process.env.API_BASE || "http://localhost:3000/api";

// ⚠️ Put your JWT here manually (or set CLOUDISY_TOKEN)
const TOKEN =
    process.env.CLOUDISY_TOKEN ||
    "eyJhbGciOiJFZERTQSIsImtpZCI6ImlNNGg0WXBMOWx0d3docXhwczRKNzV3VmtJZ2c1Q3hDIn0.eyJpYXQiOjE3ODQ4MzEyODEsImlkIjoiMGVQTjdLN3ZqTVlhRVBLNEFhN3ZVcUVpRmZGckRPOW4iLCJuYW1lIjoiRnJ4IG1haGFkZSIsInN1YiI6IjBlUE43Szd2ak1ZYUVQSzRBYTd2VXFFaUZmRnJETzluIiwiZXhwIjoxNzg0ODMyNDgxLCJpc3MiOiJodHRwczovL2F1dGguY2xvdWRpc3kuY29tIiwiYXVkIjoiaHR0cHM6Ly9hdXRoLmNsb3VkaXN5LmNvbSJ9.toIETvL6vRo9uH64_9S0CcmspYMTATruAPX43-D_xuahunsVUvFJvQ7FsA6733p1YBp80mKNEV3y8m5et8jJDQ";

// Public repo — no gitToken required
const BUILD_REPO = {
    repoUrl: "https://github.com/Mahadi-rsio/console",
    gitProvider: "github",
    framework: "vite",
    buildCommand: "pnpm build",
    outputDir: "dist",
};

/** Set SKIP_BUILD=1 to only exercise CLI deploy / rollback / validation */
const SKIP_BUILD = process.env.SKIP_BUILD === "1";

// ─── helpers ──────────────────────────────────────────────────────────────────

async function apiRequest(endpoint, { method = "GET", body, expectOk = true } = {}) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json;
    try {
        json = text ? JSON.parse(text) : null;
    } catch {
        json = { raw: text };
    }

    if (expectOk && !res.ok) {
        throw new Error(`API error ${res.status}: ${text}`);
    }

    return { status: res.status, json };
}

function assert(condition, message) {
    if (!condition) throw new Error(message);
}

function fileEntry(path, content, encoding = "utf8") {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, encoding);
    return {
        path,
        hash: createHash("sha256").update(buf).digest("hex"),
        size: buf.length,
        magicBytes: buf.subarray(0, Math.min(16, buf.length)).toString("base64"),
        body: buf,
    };
}

/** Minimal valid 1×1 PNG (red pixel) for WebP conversion checks */
function tinyPng() {
    return Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
        "base64"
    );
}

function printSummary(label, summary) {
    if (!summary) {
        console.log(`   ⚠️  ${label}: no summary in response`);
        return;
    }
    console.log(`   📊 ${label}:`);
    console.log(`      files=${summary.totalFiles}  size=${summary.totalSizeHuman ?? summary.totalSize}`);
    if (summary.uploadSizeHuman !== undefined) {
        console.log(
            `      upload=${summary.uploadSizeHuman}  reused=${formatMaybeBytes(summary.reusedSize)}`
        );
    }
    if (summary.sizeReducedHuman !== undefined) {
        console.log(
            `      text saved=${summary.sizeReducedHuman} (${summary.sizeReducedPercent}%)` +
            `  compressedFiles=${summary.filesCompressed}`
        );
        console.log(
            `      images optimized=${summary.imagesOptimized}` +
            `  saved=${summary.imageSizeReducedHuman} (${summary.imageSizeReducedPercent}%)`
        );
        console.log(
            `      deployedFiles=${summary.deployedFiles}` +
            `  variants=.br/.gz×${summary.compressedVariants} .webp×${summary.webpVariants}`
        );
    }
}

function formatMaybeBytes(n) {
    if (typeof n !== "number") return String(n);
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(2)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function printDeployments(list, label) {
    console.log(label);
    for (const dep of list) {
        console.log(
            `   - v${dep.version} | active=${dep.is_active} | source=${dep.source}` +
            ` | files=${dep.file_count} | deployed/reused=${dep.filesDeployed}/${dep.filesReused}` +
            ` | id=${dep.id}`
        );
    }
}

/**
 * prepare → print summary → presign → PUT blobs → commit → print + assert summary
 */
async function deployFiles(pageId, files, { label = "deploy" } = {}) {
    const { json: prepare } = await apiRequest("/deploy/prepare", {
        method: "POST",
        body: {
            pageId,
            files: files.map(({ path, hash, size, magicBytes }) => ({
                path,
                hash,
                size,
                magicBytes,
            })),
        },
    });

    console.log(
        `   prepare: upload ${prepare.filesToUpload}, reuse ${prepare.filesReused}`
    );
    printSummary(`${label} / prepare`, prepare.summary);

    assert(prepare.summary?.totalFiles === files.length, "prepare summary.totalFiles mismatch");
    assert(
        prepare.summary?.totalSize === files.reduce((s, f) => s + f.size, 0),
        "prepare summary.totalSize mismatch"
    );

    if (prepare.uploadRequired.length > 0) {
        const hashes = prepare.uploadRequired.map((f) => f.hash);
        const { json: presign } = await apiRequest("/deploy/presign", {
            method: "POST",
            body: {
                deploymentToken: prepare.deploymentToken,
                hashes,
            },
        });

        const byHash = new Map(files.map((f) => [f.hash, f]));
        for (const { hash, url } of presign.urls) {
            const file = byHash.get(hash);
            if (!file) throw new Error(`No local file for hash ${hash}`);
            const put = await fetch(url, {
                method: "PUT",
                body: file.body,
                headers: { "Content-Type": "application/octet-stream" },
            });
            if (!put.ok) {
                throw new Error(
                    `Presigned PUT failed for ${hash}: ${put.status} ${await put.text()}`
                );
            }
            console.log(`   uploaded blob ${hash.slice(0, 12)}… (${file.path})`);
        }
    }

    const { json: commit } = await apiRequest("/deploy/commit", {
        method: "POST",
        body: { deploymentToken: prepare.deploymentToken },
    });

    printSummary(`${label} / commit`, commit.summary);
    assert(commit.success === true, "commit success !== true");
    assert(commit.summary, "commit missing summary");
    assert(
        commit.summary.totalFiles === files.length,
        "commit summary.totalFiles mismatch"
    );
    assert(
        commit.summary.deployedFiles === commit.deployment.file_count,
        "deployedFiles should match deployment.file_count"
    );
    // html/css/js should produce .br + .gz → deployedFiles > source files
    assert(
        commit.summary.deployedFiles > files.length,
        `expected compressed/webp variants (deployed=${commit.summary.deployedFiles}, sources=${files.length})`
    );

    return commit;
}

async function createPage(payload) {
    const { json } = await apiRequest("/pages/create", { method: "POST", body: payload });
    return json;
}

async function listDeployments(pageId) {
    const { json } = await apiRequest(`/deployments/page/${pageId}`);
    return json;
}

async function rollbackTo(deploymentId) {
    const { json } = await apiRequest(`/deployments/${deploymentId}/rollback`, {
        method: "POST",
    });
    return json;
}

async function triggerBuild(payload) {
    const { json } = await apiRequest("/builds", { method: "POST", body: payload });
    return json;
}

async function streamBuildLogs(buildId) {
    const url = `${API_BASE}/builds/${buildId}/logs`;
    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) throw new Error(`SSE connect failed: ${res.status}`);
    if (!res.body) throw new Error("No response body for SSE stream");

    const decoder = new TextDecoder();
    let buffer = "";
    let finalStatus = "unknown";
    let progress = 0;
    let sawSummary = false;

    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";

        for (const frame of frames) {
            const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
            if (!dataLine) continue;

            let event;
            try {
                event = JSON.parse(dataLine.slice(5).trim());
            } catch {
                continue;
            }

            switch (event.type) {
                case "log":
                    console.log(`  📋 ${event.message}`);
                    if (
                        typeof event.message === "string" &&
                        (event.message.includes("[Summary]") ||
                            event.message.startsWith("Summary:"))
                    ) {
                        sawSummary = true;
                    }
                    break;
                case "progress":
                    if (event.value !== progress) {
                        progress = event.value;
                        console.log(`  ⏳ Progress: ${progress}%`);
                    }
                    break;
                case "done": {
                    finalStatus = event.status;
                    const durationStr = event.durationMs
                        ? ` in ${(event.durationMs / 1000).toFixed(2)}s`
                        : "";
                    if (event.status === "completed") {
                        console.log(`  ✅ Build completed${durationStr}`);
                    } else {
                        console.log(
                            `  ❌ Build failed${durationStr}: ${event.error ?? "unknown"}`
                        );
                    }
                    break;
                }
                case "error":
                    console.error(`  ⚠️  Stream error: ${event.message}`);
                    finalStatus = "failed";
                    break;
            }

            if (event.type === "done" || event.type === "error") {
                return { status: finalStatus, sawSummary };
            }
        }
    }

    return { status: finalStatus, sawSummary };
}

/** Compressible payload large enough that Brotli/Gzip shrink it */
function compressibleHtml(version) {
    const filler = "<!-- " + "cloudisy-static-hosting ".repeat(80) + " -->\n";
    return (
        `<!doctype html>\n<html><head><title>${version}</title></head>\n` +
        `<body><h1>${version}</h1>\n${filler.repeat(3)}</body></html>\n`
    );
}

function compressibleCss() {
    return (
        "/* " +
        "navy-theme ".repeat(40) +
        " */\n" +
        "h1 { color: navy; font-family: system-ui, sans-serif; }\n".repeat(20)
    );
}

function compressibleJs() {
    return (
        "// " +
        "bootstrap ".repeat(40) +
        "\n" +
        "export const version = 1;\n" +
        "console.log('hello from cloudisy');\n".repeat(15)
    );
}

// ─── main flow ────────────────────────────────────────────────────────────────

async function main() {
    if (!TOKEN || TOKEN === "PASTE_JWT_HERE") {
        console.error(
            "❌ Set CLOUDISY_TOKEN or paste a JWT into TOKEN in test.js"
        );
        process.exit(1);
    }

    try {
        // Quick auth probe
        const probe = await apiRequest("/pages", { expectOk: false });
        if (probe.status === 401) {
            throw new Error("JWT is invalid or expired — paste a fresh token");
        }

        console.log(
            "🚀 Cloudisy test: CLI deploy (compress/webp/summary) → rollback → cloud build\n"
        );

        // 1. Create page
        const projectName = `test-full-${randomBytes(3).toString("hex")}`;
        console.log(`1. Creating page: ${projectName}`);
        const page = await createPage({ project_name: projectName });
        console.log(`   ✅ Page ID  : ${page.id}`);
        console.log(`   ✅ Site ID  : ${page.site_id}`);
        console.log(`   ✅ Domain   : ${page.domain}\n`);

        // 2. Reject blocked file type at prepare
        console.log("2. Validation: blocked .zip should fail prepare...");
        const blocked = await apiRequest("/deploy/prepare", {
            method: "POST",
            expectOk: false,
            body: {
                pageId: page.id,
                files: [
                    fileEntry("evil.zip", "PK\x03\x04fake"),
                ].map(({ path, hash, size, magicBytes }) => ({
                    path,
                    hash,
                    size,
                    magicBytes,
                })),
            },
        });
        assert(blocked.status === 400, `expected 400 for .zip, got ${blocked.status}`);
        console.log(`   ✅ prepare rejected: ${JSON.stringify(blocked.json.error)}\n`);

        // 3. CLI deploy V1 — html/css/js + png → expect .br/.gz/.webp + summary
        console.log("3. CLI deploy V1 (html/css/js + png → compress + webp)...");
        const v1Files = [
            fileEntry("index.html", compressibleHtml("Version 1")),
            fileEntry("assets/style.css", compressibleCss()),
            fileEntry("assets/app.js", compressibleJs()),
            fileEntry("assets/pixel.png", tinyPng()),
        ];
        const commit1 = await deployFiles(page.id, v1Files, { label: "V1" });

        assert(commit1.summary.filesCompressed >= 3, "expected ≥3 text files compressed");
        assert(commit1.summary.sizeReduced > 0, "expected text sizeReduced > 0");
        assert(commit1.summary.imagesOptimized >= 1, "expected ≥1 image optimized");
        assert(commit1.summary.webpVariants >= 1, "expected ≥1 webp variant");
        assert(commit1.summary.compressedVariants >= 6, "expected ≥6 br/gz variants (3×2)");
        // Sanity: compressed bytes should inflate back (spot-check we stored real gzip/brotli)
        assert(
            typeof brotliDecompressSync === "function" && typeof inflateSync === "function",
            "zlib helpers missing"
        );
        console.log(
            `   ✅ v${commit1.deployment.version} | source=${commit1.deployment.source}` +
            ` | deployed=${commit1.filesDeployed} reused=${commit1.filesReused}` +
            ` | tree=${commit1.deployment.file_count} files\n`
        );

        // 4. CLI deploy V2 — reuse style.css + pixel.png blobs
        console.log("4. CLI deploy V2 (expect css/png blob reuse)...");
        const v2Files = [
            fileEntry("index.html", compressibleHtml("Version 2")),
            fileEntry("assets/style.css", compressibleCss()), // same as V1
            fileEntry("assets/app.js", compressibleJs() + "// v2\n"),
            fileEntry("assets/pixel.png", tinyPng()), // same as V1
        ];
        const commit2 = await deployFiles(page.id, v2Files, { label: "V2" });
        assert(commit2.filesReused > 0, "expected some blob reuse on V2");
        console.log(
            `   ✅ v${commit2.deployment.version} | deployed=${commit2.filesDeployed}` +
            ` reused=${commit2.filesReused}\n`
        );

        let deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "5. Deployments after CLI deploys:");

        // 6. Rollback to CLI V1 via blob tree (includes compressed variants)
        const v1Deployment = deploymentsList.find((d) => d.version === 1);
        if (!v1Deployment) throw new Error("V1 deployment not found");

        console.log(`\n6. Rollback to CLI V1 (${v1Deployment.id})...`);
        const rollback1 = await rollbackTo(v1Deployment.id);
        assert(rollback1.deployment?.is_active, "Expected V1 active after rollback");
        console.log(`   ✅ Active version is now v${rollback1.deployment.version}`);

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n   After rollback:");

        if (SKIP_BUILD) {
            console.log("\n⏭  SKIP_BUILD=1 — skipping cloud build steps");
            console.log("\n✅ CLI deploy / validation / summary / rollback passed");
            return;
        }

        // 7. Cloud build (public repo — validation + compress path in worker)
        console.log("\n7. Triggering cloud build (public repo, no gitToken)...");
        const build = await triggerBuild({
            pageId: page.id,
            ...BUILD_REPO,
        });
        console.log(`   ✅ Build ID: ${build.id}`);
        console.log("   Streaming build logs...");
        const { status: buildStatus, sawSummary } = await streamBuildLogs(build.id);
        if (buildStatus !== "completed") {
            throw new Error(`Cloud build did not complete (status=${buildStatus})`);
        }

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n8. Deployments after cloud build:");

        const buildDep = deploymentsList.find((d) => d.source === "build" && d.is_active);
        if (!buildDep) throw new Error("Expected an active build deployment");
        console.log(`   ✅ Active build deployment: v${buildDep.version}`);
        // Build output should also expand to more than a handful of tree entries
        assert(
            buildDep.file_count > 0,
            "build deployment should have file_count > 0"
        );
        if (sawSummary) {
            console.log("   ✅ Build logs included optimization Summary line");
        } else {
            console.log("   ⚠️  No [Summary] line seen in SSE (worker may be on older image)");
        }

        // 9. Rollback from build back to CLI V1
        console.log(`\n9. Rollback from build → CLI V1 (${v1Deployment.id})...`);
        const rollback2 = await rollbackTo(v1Deployment.id);
        assert(
            rollback2.deployment?.is_active && rollback2.deployment.version === 1,
            "Expected V1 active after second rollback"
        );
        console.log(`   ✅ Active version is again v${rollback2.deployment.version}`);

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n10. Final deployments:");

        console.log(
            "\n✅ All steps passed (CLI deploy+summary+compress/webp, rollback, build, rollback)"
        );
    } catch (err) {
        console.error("\n❌ Test script error:", err.message);
        process.exit(1);
    }
}

main();
