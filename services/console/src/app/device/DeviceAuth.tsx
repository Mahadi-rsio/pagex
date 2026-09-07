"use client";

import { ArrowRight, Monitor, Shield, Zap } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import PageSpinner from "@/components/pageloader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { navigateToDeviceApprove } from "@/lib/navigate";
import { cn } from "@/lib/utils";

function DeviceAuthContent() {
    const searchParams = useSearchParams();
    const [userCode, setUserCode] = useState("");
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState("");

    useEffect(() => {
        const codeFromParams =
            searchParams.get("user_code") || searchParams.get("code");
        if (codeFromParams) {
            const clean = codeFromParams.replace(/-/g, "").toUpperCase();
            const formatted =
                clean.length >= 4
                    ? `${clean.slice(0, 4)}-${clean.slice(4)}`
                    : clean;
            setUserCode(formatted);
        }
    }, [searchParams]);

    const handleInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        let val = e.target.value
            .replace(/[^a-zA-Z0-9]/g, "")
            .toUpperCase()
            .slice(0, 8);
        if (val.length > 4) val = `${val.slice(0, 4)}-${val.slice(4)}`;
        setUserCode(val);
        setError("");
    };

    const handleSubmit = async () => {
        const formattedCode = userCode.trim().replace(/-/g, "").toUpperCase();
        if (formattedCode.length < 8) {
            setError("Please enter a valid 8-character code.");
            return;
        }
        setIsLoading(true);
        setError("");
        try {
            const res = await fetch(
                `/api/auth/device?user_code=${encodeURIComponent(formattedCode)}`,
                { method: "GET", credentials: "include" },
            );
            if (res.ok) {
                navigateToDeviceApprove(formattedCode);
            } else {
                setError("Invalid or expired code. Please try again.");
            }
        } catch {
            setError(
                "Could not verify code. Check your connection and try again.",
            );
        } finally {
            setIsLoading(false);
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") handleSubmit();
    };

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
                        <div className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                            <Shield className="size-3" />
                            Secure Auth
                        </div>
                    </div>

                    <div className="space-y-2">
                        <div className="flex size-10 items-center justify-center border border-border bg-muted/40">
                            <Monitor className="size-5 text-foreground" />
                        </div>
                        <h1 className="text-2xl font-semibold tracking-tight">
                            Connect a Device
                        </h1>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                            Enter the code displayed on the device you want to
                            authorize.
                        </p>
                    </div>

                    <div className="space-y-2">
                        <label
                            htmlFor="device-code"
                            className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground"
                        >
                            Device Code
                        </label>
                        <Input
                            id="device-code"
                            value={userCode}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            placeholder="XXXX-XXXX"
                            maxLength={9}
                            autoFocus
                            className={cn(
                                "h-12 rounded-none text-center font-mono text-xl tracking-[0.35em]",
                                "focus-visible:ring-1",
                                error &&
                                    "border-destructive focus-visible:ring-destructive",
                            )}
                        />
                        {error && (
                            <p className="pt-0.5 text-xs text-destructive">
                                {error}
                            </p>
                        )}
                    </div>

                    <Button
                        type="button"
                        onClick={handleSubmit}
                        disabled={
                            isLoading || userCode.replace(/-/g, "").length < 8
                        }
                        className="h-11 w-full rounded-none text-sm font-medium tracking-wide disabled:cursor-not-allowed disabled:opacity-40"
                    >
                        {isLoading ? (
                            <>
                                <Spinner size="inline" className="mr-2" />
                                Verifying…
                            </>
                        ) : (
                            <>
                                <span>Continue</span>
                                <ArrowRight className="ml-2 size-4" />
                            </>
                        )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground">
                        Only authorize devices you own or trust
                    </p>
                </div>
            </div>
        </div>
    );
}

export default function DeviceAuthorizationPage() {
    return (
        <Suspense fallback={<PageSpinner label="Loading" />}>
            <DeviceAuthContent />
        </Suspense>
    );
}
