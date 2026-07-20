const API_BASE = "http://localhost:3000/api";

// ⚠️ Put your token here manually
const TOKEN = "eyJhbGciOiJFZERTQSIsImtpZCI6ImlNNGg0WXBMOWx0d3docXhwczRKNzV3VmtJZ2c1Q3hDIn0.eyJpYXQiOjE3ODQ1NDY3MjEsImlkIjoiSGp3UHdSRTJqamlUcXVNMTRBVlNQZFFVRjdZN3k1eU4iLCJuYW1lIjoiY2xvdWRpc3kiLCJzdWIiOiJIandQd1JFMmpqaVRxdU0xNEFWU1BkUVVGN1k3eTV5TiIsImV4cCI6MTc4NDU0NzkyMSwiaXNzIjoiaHR0cHM6Ly9hdXRoLmNsb3VkaXN5LmNvbSIsImF1ZCI6Imh0dHBzOi8vYXV0aC5jbG91ZGlzeS5jb20ifQ.yEI8B8mzpft1CIU8n8mmPHLlIeYdc-h072agUK00zJY5oXZKOViTxBAlG7em7LsCPoiIkUAO3fWvNJimQXjaCw" 





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

// ─── SSE log streaming ────────────────────────────────────────────────────────

/**
 * Streams build logs via SSE until the build completes or fails.
 * Returns the final status ("completed" | "failed").
 */
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

        // SSE frames are separated by double newlines
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? ""; // keep incomplete frame in buffer

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
                    // printed only when it changes meaningfully via done
                    break;
                case "done":
                    finalStatus = event.status;
                    if (event.status === "completed") {
                        console.log("  ✅ Build completed!");
                    } else {
                        console.log(`  ❌ Build failed: ${event.error ?? "unknown error"}`);
                    }
                    break;
                case "error":
                    console.error(`  ⚠️  Stream error: ${event.message}`);
                    finalStatus = "failed";
                    break;
            }

            // Once done event received, stop reading
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
        console.log("🚀 Starting Cloudisy build & deploy test\n");

        // 1. Create page
        const projectName = `test-build-${Math.floor(Math.random() * 10000)}`;
        console.log(`1. Creating page: ${projectName}`);
        const page = await createPage({ project_name: projectName });
        console.log(`   ✅ Page ID  : ${page.id}`);
        console.log(`   ✅ Site ID  : ${page.site_id}`);
        console.log(`   ✅ Domain   : ${page.domain}\n`);

        // 2. Trigger build
        console.log("2. Triggering cloud build...");
        const build = await triggerBuild({
            pageId: page.id,
            repoUrl: "https://github.com/Mahadi-rsio/console",
            gitProvider: "github",
            gitToken: "YOUR_GITHUB_TOKEN",   // ⚠️ Replace if private repo
            framework: "vite",
            buildCommand: "pnpm build",
            outputDir: "dist",
        });
        console.log(`   ✅ Build ID : ${build.id}`);
        console.log(`   ✅ Job ID   : ${build.job_id}`);
        console.log(`   ✅ Status   : ${build.status}\n`);

        // 3. Stream logs via SSE
        console.log("3. Streaming build logs (SSE)...");
        const finalStatus = await streamBuildLogs(build.id);
        console.log(`\n   Final status: ${finalStatus}\n`);

        // 4. Build history
        console.log("4. Recent builds for this page:");
        const history = await listBuilds(page.id);
        for (const b of history) {
            const when = new Date(b.created_at).toLocaleTimeString();
            const mark = b.status === "completed" ? "✅" : b.status === "failed" ? "❌" : "⏳";
            console.log(`   ${mark} [${when}] ${b.id} — ${b.status}${b.error ? ` (${b.error})` : ""}`);
        }

    } catch (err) {
        console.error("\n❌ Test script error:", err.message);
        process.exit(1);
    }
}

main();
