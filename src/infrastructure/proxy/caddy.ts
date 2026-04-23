// src/infrastructure/proxy/caddy.ts

import { db } from '../db/db.js'
import { pages } from '../db/schema.js'

export async function setupAccessLog(caddyAdmin = "http://caddy_server:2019") {
    await fetch(`${caddyAdmin}/config/logging/logs/access`, {
        method: "PUT",
        headers: {
            "Content-Type": "application/json",
            "Origin": caddyAdmin
        },
        body: JSON.stringify({
            writer: {
                output: "file",
                filename: "/var/log/caddy/access.log",
                roll_size_mb: 50,
                roll_keep: 2
            },
            encoder: { format: "json" },
            include: ["http.log.access"]
        })
    })

    await fetch(`${caddyAdmin}/config/apps/http/servers/srv0`, {
        method: "PATCH",
        headers: {
            "Content-Type": "application/json",
            "Origin": caddyAdmin
        },
        body: JSON.stringify({
            logs: { default_logger_name: "access" }
        })
    })

    console.log("✅ Access log configured")
}

export async function restoreRoutes() {
    try {
        const projects = await db.select().from(pages)

        for (const project of projects) {
            await addCustomDomain({
                tenantId: project.id,
                projectName: project.project_name,
                customDomain: project.domain
            })
        }
    } catch (error) {
        console.error("Failed to restore routes:", error)
    }
}

export async function addCustomDomain({ tenantId, projectName, customDomain }: {
    tenantId: string,
    projectName: string,
    customDomain: string
}, {
    minioHost = "minio_server:9000",
    caddyAdmin = "http://caddy_server:2019"
} = {}) {
    const bucketName = projectName
    const routeId = `${tenantId}-${projectName}-custom`

    // Clean up existing route first
    await fetch(`${caddyAdmin}/id/${routeId}`, {
        method: "DELETE",
        headers: { "Origin": "http://caddy_server:2019" }
    }).catch(() => { })

    // Shown when bucket exists but has no files / index.html missing
    const notDeployedHandle = [
        {
            handler: "static_response",
            status_code: 404,
            body: `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
    <title>Not Deployed — ${projectName}</title>
    <style>
        body { font-family: sans-serif; display: flex; align-items: center;
               justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
        .box { text-align: center; padding: 2rem; background: white;
               border-radius: 8px; box-shadow: 0 2px 8px rgba(0,0,0,0.1); }
        h2 { color: #333; }
        p  { color: #666; }
        code { background: #eee; padding: 2px 6px; border-radius: 4px; }
    </style>
</head>
<body>
    <div class="box">
        <h2>🚀 No deployment found</h2>
        <p>Project <code>${projectName}</code> has no files uploaded yet.</p>
        <p>Deploy your build to get started.</p>
    </div>
</body>
</html>`,
            headers: {
                "Content-Type": ["text/html; charset=utf-8"]
            }
        }
    ]

    // Serves index.html — if index.html itself is missing, shows notDeployedHandle
    const indexHandle = [
        {
            handler: "rewrite",
            uri: `/${bucketName}/dist/index.html`
        },
        {
            handler: "headers",
            response: {
                set: { "Content-Type": ["text/html; charset=utf-8"] }
            }
        },
        {
            handler: "reverse_proxy",
            upstreams: [{ dial: minioHost }],
            handle_response: [
                {
                    match: { status_code: [403, 404] },
                    routes: [{ handle: notDeployedHandle }]
                }
            ]
        }
    ]

    // Serves static assets — if asset missing, falls back to index.html (SPA routing)
    const assetHandle = [
        {
            handler: "rewrite",
            uri: `/${bucketName}/dist{http.request.uri.path}`
        },
        {
            handler: "reverse_proxy",
            upstreams: [{ dial: minioHost }],
            handle_response: [
                {
                    match: { status_code: [403, 404] },
                    routes: [{ handle: indexHandle }]
                }
            ]
        }
    ]

    const route = {
        match: [{ host: [customDomain] }],
        handle: [
            {
                "@id": routeId,
                handler: "subroute",
                routes: [
                    // Root path → serve index.html directly
                    {
                        match: [{ path: ["/"] }],
                        handle: indexHandle
                    },
                    // Everything else → try asset, fallback to index.html
                    {
                        handle: assetHandle
                    }
                ]
            }
        ],
        terminal: true
    }

    const res = await fetch(`${caddyAdmin}/config/apps/http/servers/srv0/routes`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Origin": "http://caddy_server:2019"
        },
        body: JSON.stringify(route)
    })

    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Failed to add custom domain: ${err}`)
    }

    console.log(`✅ ${customDomain} added`)

    return { success: true, tenantId, projectName, customDomain }
}

export async function removeCustomDomain({
    tenantId,
    projectName
}: {
    tenantId: string,
    projectName: string
},
    caddyAdmin = "http://caddy_server:2019"
) {
    const routeId = `${tenantId}-${projectName}-custom`

    const res = await fetch(`${caddyAdmin}/id/${routeId}`, {
        method: "DELETE",
        headers: { "Origin": "http://caddy_server:2019" }
    })

    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Failed to remove custom domain: ${err}`)
    }

    return { success: true, tenantId, projectName }
}
