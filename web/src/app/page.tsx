"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyDashboardPage } from "@/components/console/ConsolePageWrappers";

export default function HomePage() {
    return (
        <ConsoleShell>
            <LazyDashboardPage />
        </ConsoleShell>
    );
}
