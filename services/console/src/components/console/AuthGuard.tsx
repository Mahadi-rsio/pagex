"use client";

import { Zap } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import PageSpinner from "@/components/pageloader";
import { Button } from "@/components/ui/button";
import { authClient } from "@/modules/auth/utils/auth-client";
import { useAppStore } from "@/store/useAppStore";

export function AuthGuard({ children }: { children: React.ReactNode }) {
    const { data: session, isPending } = authClient.useSession();
    const user = useAppStore((s) => s.user);
    const setUser = useAppStore((s) => s.setUser);
    const setTheme = useAppStore((s) => s.setTheme);
    const router = useRouter();

    useEffect(() => {
        const stored = window.localStorage.getItem("theme");
        if (stored === "light" || stored === "dark") {
            setTheme(stored);
        }
    }, [setTheme]);

    useEffect(() => {
        if (isPending) return;

        if (!session?.user) {
            setUser(null);
            return;
        }

        setUser({
            id: session.user.id,
            name: session.user.name ?? "User",
            email: session.user.email ?? "",
            avatarUrl: session.user.image ?? undefined,
        });
    }, [isPending, session, setUser]);

    if (isPending || (session?.user && !user)) {
        return <PageSpinner label="Authenticating" />;
    }

    if (!session?.user) {
        return (
            <div className="flex h-svh flex-col items-center justify-center gap-6 bg-background px-4">
                <div className="flex items-center gap-2.5">
                    <div className="flex size-9 items-center justify-center rounded-none bg-primary text-primary-foreground">
                        <Zap className="size-5" />
                    </div>
                    <span className="text-lg font-bold tracking-tight text-foreground">
                        Console
                    </span>
                </div>
                <div className="space-y-2 text-center">
                    <h1 className="text-xl font-semibold text-foreground">
                        Sign in to continue
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        Use your Cloudisy account to access the console.
                    </p>
                </div>
                <Button size="lg" onClick={() => router.push("/login")}>
                    Log in
                </Button>
            </div>
        );
    }

    return <>{children}</>;
}
