"use client";

import { useEffect } from "react";
import { toast } from "sonner";
import { Toaster } from "@/components/ui/sonner";
import { ConsoleShell } from "@/components/console/ConsoleShell";
import { LazyDashboardPage } from "@/components/console/ConsolePageWrappers";

export default function HomePage() {
    useEffect(() => {
        const checkHealth = async () => {
            try {
                const res = await fetch("http://api:3000/health");
                if (!res.ok) throw new Error(`HTTP ${res.status}`);
                const data = await res.json();
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
        <>
            <Toaster />
            <ConsoleShell>
                <LazyDashboardPage />
            </ConsoleShell>
        </>
    );
}
