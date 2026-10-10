"use client";

import { LazyStoragePage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";

export default function StoragePage() {
    return (
        <ConsoleShell>
            <LazyStoragePage />
        </ConsoleShell>
    );
}
