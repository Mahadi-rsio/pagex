"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import PageSpinner from "@/components/pageloader";
import { authClient } from "@/modules/auth/utils/auth-client";
import { LoginPage } from "./LoginPage";

export default function Login() {
    const router = useRouter();
    const { data: session, isPending } = authClient.useSession();

    useEffect(() => {
        if (!isPending && session?.user) {
            router.replace("/");
        }
    }, [isPending, session, router]);

    if (isPending || session?.user) {
        return <PageSpinner label="Loading" />;
    }

    return <LoginPage />;
}
