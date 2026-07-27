"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyCreateProjectPage } from "@/components/console/ConsolePageWrappers";

export default function CreateProjectPageRoute() {
    return (
        <ConsoleShell>
            <LazyCreateProjectPage />
        </ConsoleShell>
    );
}
