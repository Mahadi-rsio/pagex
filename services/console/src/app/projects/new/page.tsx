"use client";

import { LazyCreateProjectPage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";

export default function CreateProjectPageRoute() {
    return (
        <ConsoleShell>
            <LazyCreateProjectPage />
        </ConsoleShell>
    );
}
