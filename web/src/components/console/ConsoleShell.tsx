"use client";

import { AuthGuard } from "@/components/console/AuthGuard";
import { Layout } from "@/components/console/Layout";

export function ConsoleShell({ children }: { children: React.ReactNode }) {
    return (
        <AuthGuard>
            <Layout>{children}</Layout>
        </AuthGuard>
    );
}
