"use client";

import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyBillingPage } from "@/components/console/ConsolePageWrappers";

export default function BillingPage() {
    return (
        <ConsoleShell>
            <LazyBillingPage />
        </ConsoleShell>
    );
}
