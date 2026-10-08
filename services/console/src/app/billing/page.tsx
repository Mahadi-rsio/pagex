"use client";

import { LazyBillingPage } from "@/components/console/ConsolePageWrappers";
import { ConsoleShell } from "@/components/console/ConsoleShell";

export default function BillingPage() {
    return (
        <ConsoleShell>
            <LazyBillingPage />
        </ConsoleShell>
    );
}
