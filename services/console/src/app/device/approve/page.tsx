"use client";

import {
    CheckCircle2,
    Monitor,
    ShieldCheck,
    ShieldX,
    XCircle,
    Zap,
} from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AuthGuard } from "@/components/console/AuthGuard";
import PageSpinner from "@/components/pageloader";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { navigateHome } from "@/lib/navigate";
import { cn } from "@/lib/utils";

type Status = "idle" | "approving" | "denying" | "approved" | "denied";

function DeviceApprovalContent() {
    const searchParams = useSearchParams();
    const rawCode = (searchParams.get("user_code") ?? "")
        .replace(/-/g, "")
        .toUpperCase();
    const displayCode =
        rawCode.length >= 4
            ? `${rawCode.slice(0, 4)}-${rawCode.slice(4)}`
            : rawCode;

    const [status, setStatus] = useState<Status>("idle");

    const handleApprove = async () => {
        if (!rawCode) return;
        setStatus("approving");
        try {
            const res = await fetch("/api/auth/device/approve", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userCode: rawCode }),
            });
            if (!res.ok) throw new Error("approve failed");
            setStatus("approved");
            setTimeout(() => navigateHome(), 2000);
        } catch {
            setStatus("idle");
        }
    };

    const handleDeny = async () => {
        if (!rawCode) return;
        setStatus("denying");
        try {
            const res = await fetch("/api/auth/device/deny", {
                method: "POST",
                credentials: "include",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ userCode: rawCode }),
            });
            if (!res.ok) throw new Error("deny failed");
            setStatus("denied");
            setTimeout(() => navigateHome(), 2000);
        } catch {
            setStatus("idle");
        }
    };

    const isProcessing = status === "approving" || status === "denying";

    if (status === "approved") {
        return (
            <ResultScreen
                icon={<CheckCircle2 className="size-10 text-foreground" />}
                title="Device Approved"
                message="The device now has access to your account. Redirecting you home…"
            />
        );
    }

    if (status === "denied") {
        return (
            <ResultScreen
                icon={<XCircle className="size-10 text-destructive" />}
                title="Access Denied"
                message="The device has been blocked. Redirecting you home…"
            />
        );
    }

    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-grid opacity-40"
            />

            <div className="relative z-10 w-full max-w-md rounded-none border border-border bg-background p-6 sm:p-8">
                <div className="relative z-[1] space-y-6">
                    <div className="flex items-center justify-between">
                        <Link
                            href="/"
                            className="flex items-center gap-2 transition-opacity hover:opacity-80"
                        >
                            <div className="flex size-8 items-center justify-center border border-border bg-foreground text-background">
                                <Zap className="size-3.5" strokeWidth={2.25} />
                            </div>
                            <span className="text-sm font-bold tracking-tight">
                                Console
                            </span>
                        </Link>
                        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            Auth Request
                        </span>
                    </div>

                    <div className="space-y-2">
                        <div className="flex size-10 items-center justify-center border border-border bg-muted/40">
                            <Monitor className="size-5 text-foreground" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Approve Device Access?
                        </h1>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            A device is requesting access to your account. Only
                            approve if you initiated this request.
                        </p>
                    </div>

                    <div className="flex items-center justify-between border border-border bg-muted/30 px-4 py-4">
                        <div>
                            <p className="mb-1 text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
                                Device Code
                            </p>
                            <p className="font-mono text-xl font-semibold tracking-[0.3em]">
                                {displayCode || "—"}
                            </p>
                        </div>
                        <div className="flex size-9 items-center justify-center border border-border bg-background">
                            <Monitor className="size-4 text-muted-foreground" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleDeny}
                            disabled={isProcessing || !rawCode}
                            className={cn(
                                "h-11 rounded-none text-sm font-medium",
                                "border-destructive text-destructive",
                                "hover:bg-destructive/10",
                                "disabled:opacity-40",
                            )}
                        >
                            {status === "denying" ? (
                                <Spinner size="inline" />
                            ) : (
                                <>
                                    <ShieldX className="mr-1.5 size-4" />
                                    Deny
                                </>
                            )}
                        </Button>

                        <Button
                            type="button"
                            onClick={handleApprove}
                            disabled={isProcessing || !rawCode}
                            className="h-11 rounded-none text-sm font-medium disabled:opacity-40"
                        >
                            {status === "approving" ? (
                                <Spinner size="inline" />
                            ) : (
                                <>
                                    <ShieldCheck className="mr-1.5 size-4" />
                                    Approve
                                </>
                            )}
                        </Button>
                    </div>

                    <p className="text-center text-xs text-muted-foreground">
                        Never approve a device you don&apos;t recognise
                    </p>
                </div>
            </div>
        </div>
    );
}

function ResultScreen({
    icon,
    title,
    message,
}: {
    icon: React.ReactNode;
    title: string;
    message: string;
}) {
    return (
        <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-4">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-grid opacity-40"
            />
            <div className="relative z-10 w-full max-w-sm rounded-none border border-border bg-background p-8 text-center">
                <div className="relative z-[1] space-y-3">
                    <div className="mb-2 flex justify-center">{icon}</div>
                    <h2 className="text-xl font-semibold tracking-tight">
                        {title}
                    </h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                        {message}
                    </p>
                    <div className="pt-2">
                        <Spinner size="inline" className="mx-auto" />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function DeviceApprovalPage() {
    return (
        <AuthGuard>
            <Suspense fallback={<PageSpinner label="Loading" />}>
                <DeviceApprovalContent />
            </Suspense>
        </AuthGuard>
    );
}
