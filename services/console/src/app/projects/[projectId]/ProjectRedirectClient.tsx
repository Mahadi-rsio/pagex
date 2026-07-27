"use client";

import { useEffect } from "react";
import { getProjectIdFromPathname } from "@/lib/navigate";

export function ProjectRedirectClient() {
    useEffect(() => {
        const projectId = getProjectIdFromPathname();
        if (projectId) {
            // Full page load so Caddy can rewrite to the SSG shell.
            window.location.replace(`/projects/${projectId}/overview/`);
        }
    }, []);

    return (
        <div className="flex h-svh items-center justify-center bg-background">
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
    );
}
