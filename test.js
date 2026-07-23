import { createHash, randomBytes } from "node:crypto";

const API_BASE = "http://localhost:3000/api";

// ⚠️ Put your JWT here manually
const TOKEN = "eyJhbGciOiJFZERTQSIsImtpZCI6ImlNNGg0WXBMOWx0d3docXhwczRKNzV3VmtJZ2c1Q3hDIn0.eyJpYXQiOjE3ODQ4MTMxNDIsImlkIjoiMGVQTjdLN3ZqTVlhRVBLNEFhN3ZVcUVpRmZGckRPOW4iLCJuYW1lIjoiRnJ4IG1haGFkZSIsInN1YiI6IjBlUE43Szd2ak1ZYUVQSzRBYTd2VXFFaUZmRnJETzluIiwiZXhwIjoxNzg0ODE0MzQyLCJpc3MiOiJodHRwczovL2F1dGguY2xvdWRpc3kuY29tIiwiYXVkIjoiaHR0cHM6Ly9hdXRoLmNsb3VkaXN5LmNvbSJ9.2ktIUqNyKQm_P4zMhus823nMNITyLZBnShFPucLapBmQ5awrjBLIydU1PwlyAR-1v_Rdfh233VpbHY8FxdgxDw"

// Public repo — no gitToken required
const BUILD_REPO = {
    repoUrl: "https://github.com/Mahadi-rsio/console",
    gitProvider: "github",
    framework: "vite",
    buildCommand: "pnpm build",
    outputDir: "dist",
};

// ─── helpers ──────────────────────────────────────────────────────────────────

async function apiRequest(endpoint, { method = "GET", body } = {}) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
        method,
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${TOKEN}`,
        },
        body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`API error ${res.status}: ${text}`);
    }

    return res.json();
}

function fileEntry(path, content) {
    const buf = Buffer.from(content, "utf8");
    return {
        path,
        hash: createHash("sha256").update(buf).digest("hex"),
        size: buf.length,
        magicBytes: buf.subarray(0, Math.min(16, buf.length)).toString("base64"),
        body: buf,
    };
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

async function deployFiles(pageId, files) {
    const prepare = await apiRequest("/deploy/prepare", {
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

    console.log(`   prepare: upload ${prepare.filesToUpload}, reuse ${prepare.filesReused}`);

    if (prepare.uploadRequired.length > 0) {
        const hashes = prepare.uploadRequired.map((f) => f.hash);
        const { urls } = await apiRequest("/deploy/presign", {
            method: "POST",
            body: {
                deploymentToken: prepare.deploymentToken,
                hashes,
            },
        });

        const byHash = new Map(files.map((f) => [f.hash, f]));
        for (const { hash, url } of urls) {
            const file = byHash.get(hash);
            if (!file) throw new Error(`No local file for hash ${hash}`);
            const put = await fetch(url, {
                method: "PUT",
                body: file.body,
                headers: { "Content-Type": "application/octet-stream" },
            });
            if (!put.ok) {
                throw new Error(`Presigned PUT failed for ${hash}: ${put.status} ${await put.text()}`);
            }
            console.log(`   uploaded blob ${hash.slice(0, 12)}…`);
        }
    }

    return apiRequest("/deploy/commit", {
        method: "POST",
        body: { deploymentToken: prepare.deploymentToken },
    });
}

async function createPage(payload) {
    return apiRequest("/pages/create", { method: "POST", body: payload });
}

async function listDeployments(pageId) {
    return apiRequest(`/deployments/page/${pageId}`);
}

async function rollbackTo(deploymentId) {
    return apiRequest(`/deployments/${deploymentId}/rollback`, { method: "POST" });
}

async function triggerBuild(payload) {
    return apiRequest("/builds", { method: "POST", body: payload });
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
                        console.log(`  ❌ Build failed${durationStr}: ${event.error ?? "unknown"}`);
                    }
                    break;
                }
                case "error":
                    console.error(`  ⚠️  Stream error: ${event.message}`);
                    finalStatus = "failed";
                    break;
            }

            if (event.type === "done" || event.type === "error") {
                return finalStatus;
            }
        }
    }

    return finalStatus;
}

// ─── main flow ────────────────────────────────────────────────────────────────

async function main() {
    try {
        console.log("🚀 Cloudisy test: CLI deploy → rollback → cloud build → rollback\n");

        // 1. Create page
        const projectName = `test-full-${randomBytes(3).toString("hex")}`;
        console.log(`1. Creating page: ${projectName}`);
        const page = await createPage({ project_name: projectName });
        console.log(`   ✅ Page ID  : ${page.id}`);
        console.log(`   ✅ Site ID  : ${page.site_id}`);
        console.log(`   ✅ Domain   : ${page.domain}\n`);

        // 2. CLI deploy V1 (prepare → presign → commit)
        console.log("2. CLI deploy V1 (prepare → presign → commit)...");
        const v1Files = [
            fileEntry("index.html", "<!doctype html><title>V1</title><h1>Version 1</h1>"),
            fileEntry("style.css", "h1 { color: navy; }"),
        ];
        const commit1 = await deployFiles(page.id, v1Files);
        console.log(
            `   ✅ v${commit1.deployment.version} | source=${commit1.deployment.source}` +
            ` | deployed=${commit1.filesDeployed} reused=${commit1.filesReused}\n`
        );

        // 3. CLI deploy V2 (style.css blob should be reused)
        console.log("3. CLI deploy V2 (expect style.css blob reuse)...");
        const v2Files = [
            fileEntry("index.html", "<!doctype html><title>V2</title><h1>Version 2</h1>"),
            fileEntry("style.css", "h1 { color: navy; }"),
        ];
        const commit2 = await deployFiles(page.id, v2Files);
        console.log(
            `   ✅ v${commit2.deployment.version} | source=${commit2.deployment.source}` +
            ` | deployed=${commit2.filesDeployed} reused=${commit2.filesReused}\n`
        );

        let deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "4. Deployments after CLI deploys:");

        // 5. Rollback to CLI V1 via blob tree
        const v1Deployment = deploymentsList.find((d) => d.version === 1);
        if (!v1Deployment) throw new Error("V1 deployment not found");

        console.log(`\n5. Rollback to CLI V1 (${v1Deployment.id})...`);
        const rollback1 = await rollbackTo(v1Deployment.id);
        if (!rollback1.deployment?.is_active) {
            throw new Error("Expected V1 to be active after rollback");
        }
        console.log(`   ✅ Active version is now v${rollback1.deployment.version}`);

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n   After rollback:");

        // 6. Cloud build (public repo, no gitToken — blob-store deploy path)
        console.log("\n6. Triggering cloud build (public repo, no gitToken)...");
        const build = await triggerBuild({
            pageId: page.id,
            ...BUILD_REPO,
        });
        console.log(`   ✅ Build ID: ${build.id}`);
        console.log("   Streaming build logs...");
        const buildStatus = await streamBuildLogs(build.id);
        if (buildStatus !== "completed") {
            throw new Error(`Cloud build did not complete (status=${buildStatus})`);
        }

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n7. Deployments after cloud build:");

        const buildDep = deploymentsList.find((d) => d.source === "build" && d.is_active);
        if (!buildDep) throw new Error("Expected an active build deployment");
        console.log(`   ✅ Active build deployment: v${buildDep.version}`);

        // 8. Rollback from build back to CLI V1
        console.log(`\n8. Rollback from build → CLI V1 (${v1Deployment.id})...`);
        const rollback2 = await rollbackTo(v1Deployment.id);
        if (!rollback2.deployment?.is_active || rollback2.deployment.version !== 1) {
            throw new Error("Expected V1 active after second rollback");
        }
        console.log(`   ✅ Active version is again v${rollback2.deployment.version}`);

        deploymentsList = await listDeployments(page.id);
        printDeployments(deploymentsList, "\n9. Final deployments:");

        console.log("\n✅ All steps passed (CLI deploy, rollback, build, rollback)");
    } catch (err) {
        console.error("\n❌ Test script error:", err.message);
        process.exit(1);
    }
}

main();
