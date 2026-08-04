"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyDashboardPage } from "@/components/console/ConsolePageWrappers";
import { apiClient } from "@/lib/api-client";

export default function HomePage() {
    useEffect(() => {
        const checkHealth = async () => {
            try {
                const data = await apiClient.healthCheck();
                if (data.message === "ok") {
                    toast.success("Server connected");
                } else {
                    toast.error("Server error");
                }
            } catch {
                toast.error("Failed to connect to server");
            }
        };
        checkHealth();
    }, []);

    return (
        <ConsoleShell>
            <LazyDashboardPage />
        </ConsoleShell>
    );
}
