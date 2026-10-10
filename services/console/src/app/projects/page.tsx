"use client";

import { LazyProjectsPage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";

export default function ProjectsPage() {
    return (
        <ConsoleShell>
            <LazyProjectsPage />
        </ConsoleShell>
    );
}
