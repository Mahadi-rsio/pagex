"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyProjectsPage } from "@/components/console/ConsolePageWrappers";

export default function ProjectsPage() {
    return (
        <ConsoleShell>
            <LazyProjectsPage />
        </ConsoleShell>
    );
}
