import { db } from './db/db.js'
import { pages } from './db/schema.js'

// lib/caddy.ts
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
            addCustomDomain({
                tenantId: project.id,
                projectName: project.project_name,
                customDomain: project.domain
            })
        }

    } catch (error) {

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

    const route = {
        match: [{ host: [customDomain] }],
        handle: [
            {
                "@id": routeId,
                handler: "subroute",
                routes: [
                    {
                        match: [{ path: ["/"] }],
                        handle: [
                            { handler: "rewrite", uri: `/${bucketName}/index.html` },
                            {
                                handler: "reverse_proxy",
                                upstreams: [{ dial: minioHost }],
                                //headers: { request: { set: { Host: [minioHost] } } }
                            }
                        ]
                    },
                    {
                        handle: [
                            {
                                handler: "reverse_proxy",
                                upstreams: [{ dial: minioHost }],
                                //headers: { request: { set: { Host: [minioHost] } } },
                                rewrite: { uri: `/${bucketName}{http.request.uri.path}` },
                                handle_response: [
                                    {
                                        match: { status_code: [403, 404] },
                                        routes: [
                                            {
                                                handle: [
                                                    { handler: "rewrite", uri: `/${bucketName}/index.html` },
                                                    {
                                                        handler: "reverse_proxy",
                                                        upstreams: [{ dial: minioHost }],
                                                        //headers: { request: { set: { Host: [minioHost] } } }
                                                    }
                                                ]
                                            }
                                        ]
                                    }
                                ]
                            }
                        ]
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

    console.log(`${customDomain} added`)

    //
    // return {
    //     success: true,
    //     tenantId,
    //     projectName,
    //     customDomain,
    //     url: `http://${customDomain}`
    // }
}

export async function removeCustomDomain({
    tenantId,
    projectName
}: {
    tenantId: string,
    projectName: string
},
    caddyAdmin = "http://localhost:2019"
) {
    const routeId = `${tenantId}-${projectName}-custom`

    const res = await fetch(`${caddyAdmin}/id/${routeId}`, {
        method: "DELETE"
    })

    if (!res.ok) {
        const err = await res.text()
        throw new Error(`Failed to remove custom domain: ${err}`)
    }

    return { success: true, tenantId, projectName }
}
