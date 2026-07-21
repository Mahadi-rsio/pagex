const API_BASE = "http://localhost:3000/api";

// ⚠️ Put your token here manually
const TOKEN = "eyJhbGciOiJFZERTQSIsImtpZCI6ImlNNGg0WXBMOWx0d3docXhwczRKNzV3VmtJZ2c1Q3hDIn0.eyJpYXQiOjE3ODQ1NDk0MjUsImlkIjoiSGp3UHdSRTJqamlUcXVNMTRBVlNQZFFVRjdZN3k1eU4iLCJuYW1lIjoiY2xvdWRpc3kiLCJzdWIiOiJIandQd1JFMmpqaVRxdU0xNEFWU1BkUVVGN1k3eTV5TiIsImV4cCI6MTc4NDU1MDYyNSwiaXNzIjoiaHR0cHM6Ly9hdXRoLmNsb3VkaXN5LmNvbSIsImF1ZCI6Imh0dHBzOi8vYXV0aC5jbG91ZGlzeS5jb20ifQ.YG1JNK9DA2YDnERIl3eLuol0kSxOPY96qqMpffd4U6yE8Nap3lDtHDhtOBH6YpeVGzSf9V3K4O6v2CK4wuLLAg"







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

// ─── API wrappers ─────────────────────────────────────────────────────────────

async function createPage(payload) {
    return apiRequest("/pages/create", { method: "POST", body: payload });
}

async function triggerBuild(payload) {
    return apiRequest("/builds", { method: "POST", body: payload });
}

async function listBuilds(pageId) {
    return apiRequest(`/builds/page/${pageId}`);
}

async function listDeployments(pageId) {
    return apiRequest(`/deployments/page/${pageId}`);
}

async function rollbackTo(deploymentId) {
    return apiRequest(`/deployments/${deploymentId}/rollback`, { method: "POST" });
}

// ─── SSE log streaming ────────────────────────────────────────────────────────

async function streamBuildLogs(buildId) {
    const url = `${API_BASE}/builds/${buildId}/logs`;

    const res = await fetch(url, {
        headers: { Authorization: `Bearer ${TOKEN}` },
    });

    if (!res.ok) {
        throw new Error(`SSE connect failed: ${res.status}`);
    }

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
            const dataLine = frame.split("\n").find(l => l.startsWith("data:"));
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
                case "status":
                    break;
                case "done":
                    finalStatus = event.status;
                    const durationStr = event.durationMs ? ` in ${(event.durationMs / 1000).toFixed(2)}s` : "";
                    if (event.status === "completed") {
                        console.log(`  ✅ Build completed${durationStr}!`);
                    } else {
                        console.log(`  ❌ Build failed${durationStr}: ${event.error ?? "unknown error"}`);
                    }
                    break;
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
        console.log("🚀 Starting Cloudisy deployment rollback system test\n");

        // 1. Create page
        const projectName = `test-rollback-${Math.floor(Math.random() * 10000)}`;
        console.log(`1. Creating page: ${projectName}`);
        const page = await createPage({ project_name: projectName });
        console.log(`   ✅ Page ID  : ${page.id}`);
        console.log(`   ✅ Site ID  : ${page.site_id}`);
        console.log(`   ✅ Domain   : ${page.domain}\n`);

        // 2. Trigger deployment 1 (Build 1)
        console.log("2. Triggering deployment 1 (V1)...");
        const build1 = await triggerBuild({
            pageId: page.id,
            repoUrl: "https://github.com/Mahadi-rsio/console",
            gitProvider: "github",
            gitToken: "YOUR_GITHUB_TOKEN",
            framework: "vite",
            buildCommand: "pnpm build",
            outputDir: "dist",
        });
        console.log(`   ✅ Build ID : ${build1.id}`);
        console.log("   Streaming V1 logs...");
        await streamBuildLogs(build1.id);

        // 3. Trigger deployment 2 (Build 2)
        console.log("\n3. Triggering deployment 2 (V2)...");
        const build2 = await triggerBuild({
            pageId: page.id,
            repoUrl: "https://github.com/Mahadi-rsio/console",
            gitProvider: "github",
            gitToken: "YOUR_GITHUB_TOKEN",
            framework: "vite",
            buildCommand: "pnpm build",
            outputDir: "dist",
        });
        console.log(`   ✅ Build ID : ${build2.id}`);
        console.log("   Streaming V2 logs...");
        await streamBuildLogs(build2.id);

        // 4. List deployments
        console.log("\n4. Listing deployments history:");
        const deploymentsList = await listDeployments(page.id);
        for (const dep of deploymentsList) {
            console.log(`   - Version ${dep.version} (Active: ${dep.is_active}) | ID: ${dep.id} | Files: ${dep.file_count}`);
        }

        // 5. Rollback to V1
        const v1Deployment = deploymentsList.find(d => d.version === 1);
        if (!v1Deployment) {
            throw new Error("V1 deployment not found in list");
        }

        console.log(`\n5. Rolling back to Version 1 (ID: ${v1Deployment.id})...`);
        const rollbackResult = await rollbackTo(v1Deployment.id);
        console.log("   ✅ Rollback response:", rollbackResult);

        // 6. Verify deployments list after rollback
        console.log("\n6. Listing deployments history after rollback:");
        const updatedDeploymentsList = await listDeployments(page.id);
        for (const dep of updatedDeploymentsList) {
            console.log(`   - Version ${dep.version} (Active: ${dep.is_active}) | ID: ${dep.id} | Files: ${dep.file_count}`);
        }

    } catch (err) {
        console.error("\n❌ Test script error:", err.message);
        process.exit(1);
    }
}

main();
