"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { LoginPage } from "./LoginPage";
import { authClient } from "@/modules/auth/utils/auth-client";

export default function Login() {
    const router = useRouter();
    const { data: session, isPending } = authClient.useSession();

    useEffect(() => {
        if (!isPending && session?.user) {
            router.replace("/");
        }
    }, [isPending, session, router]);

    if (isPending || session?.user) {
        return (
            <div className="flex h-svh items-center justify-center bg-background">
                <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
            </div>
        );
    }

    return <LoginPage />;
}
