"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/modules/auth/utils/auth-client";
import { AuthGuard } from "@/components/console/AuthGuard";
import { navigateHome } from "@/lib/navigate";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import {
    Loader2,
    ShieldCheck,
    ShieldX,
    Monitor,
    CheckCircle2,
    XCircle,
} from "lucide-react";
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
            await authClient.device.approve({ userCode: rawCode });
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
            await authClient.device.deny({ userCode: rawCode });
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
                icon={<CheckCircle2 className="w-10 h-10 text-emerald-400" />}
                glow="bg-emerald-500/10"
                title="Device Approved"
                message="The device now has access to your account. Redirecting you home…"
            />
        );
    }

    if (status === "denied") {
        return (
            <ResultScreen
                icon={<XCircle className="w-10 h-10 text-red-400" />}
                glow="bg-red-500/10"
                title="Access Denied"
                message="The device has been blocked. Redirecting you home…"
            />
        );
    }

    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-amber-500/8 rounded-full blur-[140px]" />
            </div>

            <Card className="relative w-full max-w-md border border-border shadow-soft">
                <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-amber-500/50 to-transparent rounded-full" />

                <CardHeader className="pb-2 pt-8 px-8">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                            <Monitor className="w-5 h-5 text-amber-500" />
                        </div>
                        <span className="text-xs text-muted-foreground font-mono tracking-widest uppercase">
                            Authorization Request
                        </span>
                    </div>
                    <CardTitle className="text-2xl font-semibold tracking-tight">
                        Approve Device Access?
                    </CardTitle>
                    <CardDescription className="text-sm mt-1.5 leading-relaxed">
                        A device is requesting access to your account. Only
                        approve if you initiated this request.
                    </CardDescription>
                </CardHeader>

                <CardContent className="px-8 pb-8 pt-4 space-y-5">
                    <div className="rounded-xl bg-muted/50 border border-border px-4 py-4 flex items-center justify-between">
                        <div>
                            <p className="text-[11px] text-muted-foreground uppercase tracking-widest font-medium mb-1">
                                Device Code
                            </p>
                            <p className="text-xl font-mono font-semibold tracking-[0.3em]">
                                {displayCode || "—"}
                            </p>
                        </div>
                        <div className="w-9 h-9 rounded-lg bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
                            <Monitor className="w-4 h-4 text-amber-500/70" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-3 pt-1">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleDeny}
                            disabled={isProcessing || !rawCode}
                            className={cn(
                                "h-11 rounded-xl font-medium text-sm",
                                "border-destructive/30 text-destructive",
                                "hover:bg-destructive/10 hover:border-destructive/50",
                                "disabled:opacity-40 transition-all duration-200",
                            )}
                        >
                            {status === "denying" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <ShieldX className="w-4 h-4 mr-1.5" />
                                    Deny
                                </>
                            )}
                        </Button>

                        <Button
                            type="button"
                            onClick={handleApprove}
                            disabled={isProcessing || !rawCode}
                            className={cn(
                                "h-11 rounded-xl font-medium text-sm",
                                "bg-emerald-600 hover:bg-emerald-500 text-white",
                                "disabled:opacity-40 transition-all duration-200",
                            )}
                        >
                            {status === "approving" ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                <>
                                    <ShieldCheck className="w-4 h-4 mr-1.5" />
                                    Approve
                                </>
                            )}
                        </Button>
                    </div>

                    <p className="text-center text-xs text-muted-foreground">
                        Never approve a device you don't recognise
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function ResultScreen({
    icon,
    glow,
    title,
    message,
}: {
    icon: React.ReactNode;
    glow: string;
    title: string;
    message: string;
}) {
    return (
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div
                    className={cn(
                        "absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[400px] h-[400px] rounded-full blur-[100px]",
                        glow,
                    )}
                />
            </div>
            <Card className="relative w-full max-w-sm border border-border text-center shadow-soft">
                <CardContent className="pt-10 pb-8 px-8 space-y-3">
                    <div className="flex justify-center mb-2">{icon}</div>
                    <h2 className="text-xl font-semibold">{title}</h2>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                        {message}
                    </p>
                    <div className="pt-2">
                        <Loader2 className="w-4 h-4 text-muted-foreground/50 animate-spin mx-auto" />
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

export default function DeviceApprovalPage() {
    return (
        <AuthGuard>
            <Suspense
                fallback={
                    <div className="min-h-screen bg-background flex items-center justify-center">
                        <Loader2 className="w-6 h-6 text-amber-500 animate-spin" />
                    </div>
                }
            >
                <DeviceApprovalContent />
            </Suspense>
        </AuthGuard>
    );
}
