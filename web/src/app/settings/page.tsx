"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazySettingsPage } from "@/components/console/ConsolePageWrappers";

export default function SettingsPage() {
    return (
        <ConsoleShell>
            <LazySettingsPage />
        </ConsoleShell>
    );
}
