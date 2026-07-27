"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyStoragePage } from "@/components/console/ConsolePageWrappers";

export default function StoragePage() {
    return (
        <ConsoleShell>
            <LazyStoragePage />
        </ConsoleShell>
    );
}
