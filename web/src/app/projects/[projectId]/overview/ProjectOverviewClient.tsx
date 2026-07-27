"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { getProjectIdFromPathname } from "@/lib/navigate";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyProjectDetailPage } from "@/components/console/ConsolePageWrappers";

export function ProjectOverviewClient() {
    const params = useParams<{ projectId: string }>();
    const [projectId, setProjectId] = useState(() => {
        const fromParams = params.projectId;
        if (fromParams && fromParams !== "_") return fromParams;
        return "";
    });

    useEffect(() => {
        // Prefer browser pathname: Caddy serves the `_` SSG shell for all ids.
        const fromPath = getProjectIdFromPathname();
        if (fromPath) {
            setProjectId(fromPath);
            return;
        }
        if (params.projectId && params.projectId !== "_") {
            setProjectId(params.projectId);
        }
    }, [params.projectId]);

    if (!projectId) {
        return (
            <div className="flex h-svh items-center justify-center bg-background">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
        );
    }

    return (
        <ConsoleShell>
            <LazyProjectDetailPage projectId={projectId} />
        </ConsoleShell>
    );
}
