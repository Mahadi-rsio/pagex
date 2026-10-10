"use client";

import { LazySettingsPage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";

export default function SettingsPage() {
    return (
        <ConsoleShell>
            <LazySettingsPage />
        </ConsoleShell>
    );
}
