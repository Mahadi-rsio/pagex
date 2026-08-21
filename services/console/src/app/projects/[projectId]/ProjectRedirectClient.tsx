"use client";

import { useEffect } from "react";
import PageSpinner from "@/components/pageloader";
import { getProjectIdFromPathname } from "@/lib/navigate";

export function ProjectRedirectClient() {
    useEffect(() => {
        const projectId = getProjectIdFromPathname();
        if (projectId) {
            // Full page load so Caddy can rewrite to the SSG shell.
            window.location.replace(`/projects/${projectId}/overview/`);
        }
    }, []);

    return <PageSpinner label="Redirecting" />;
}
