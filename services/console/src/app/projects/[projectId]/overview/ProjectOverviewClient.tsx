"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { LazyProjectDetailPage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import PageSpinner from "@/components/pageloader";
import { getProjectIdFromPathname } from "@/lib/navigate";

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
        return <PageSpinner label="Loading project" />;
    }

    return (
        <ConsoleShell>
            <LazyProjectDetailPage projectId={projectId} />
        </ConsoleShell>
    );
}
