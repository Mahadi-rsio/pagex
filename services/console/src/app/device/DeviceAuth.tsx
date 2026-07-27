"use client";

import { useState, useEffect, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { authClient } from "@/modules/auth/utils/auth-client";
import { navigateToDeviceApprove } from "@/lib/navigate";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Loader2, Monitor, ArrowRight, Shield } from "lucide-react";
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
            const response = await authClient.device({
                query: { user_code: formattedCode },
            });
            if (response.data) {
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
        <div className="min-h-screen bg-background flex items-center justify-center p-4">
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-[color:var(--glow)]/10 rounded-full blur-[120px]" />
            </div>

            <Card className="relative w-full max-w-md border border-border shadow-soft">
                <div className="absolute top-0 left-8 right-8 h-px bg-gradient-to-r from-transparent via-[color:var(--glow)]/60 to-transparent rounded-full" />

                <CardHeader className="pb-2 pt-8 px-8">
                    <div className="flex items-center gap-3 mb-5">
                        <div className="w-10 h-10 rounded-xl bg-[color:var(--glow)]/10 border border-[color:var(--glow)]/20 flex items-center justify-center">
                            <Monitor className="w-5 h-5 text-[color:var(--glow)]" />
                        </div>
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground font-mono tracking-widest uppercase">
                            <Shield className="w-3 h-3" />
                            Secure Authorization
                        </div>
                    </div>
                    <CardTitle className="text-2xl font-semibold tracking-tight">
                        Connect a Device
                    </CardTitle>
                    <CardDescription className="text-sm mt-1.5 leading-relaxed">
                        Enter the code displayed on the device you want to
                        authorize.
                    </CardDescription>
                </CardHeader>

                <CardContent className="px-8 pb-8 pt-4 space-y-4">
                    <div className="space-y-2">
                        <label className="text-xs font-medium text-muted-foreground tracking-wider uppercase">
                            Device Code
                        </label>
                        <Input
                            value={userCode}
                            onChange={handleInput}
                            onKeyDown={handleKeyDown}
                            placeholder="XXXX-XXXX"
                            maxLength={9}
                            autoFocus
                            className={cn(
                                "h-12 text-center text-xl font-mono tracking-[0.35em] rounded-xl",
                                "focus-visible:ring-1 transition-all duration-200",
                                error &&
                                    "border-destructive focus-visible:ring-destructive",
                            )}
                        />
                        {error && (
                            <p className="text-xs text-destructive pt-0.5">
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
                        className="w-full h-11 rounded-xl font-medium text-sm tracking-wide disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-200"
                    >
                        {isLoading ? (
                            <>
                                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                Verifying…
                            </>
                        ) : (
                            <>
                                <span>Continue</span>
                                <ArrowRight className="w-4 h-4 ml-2" />
                            </>
                        )}
                    </Button>

                    <p className="text-center text-xs text-muted-foreground pt-1">
                        Only authorize devices you own or trust
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

export default function DeviceAuthorizationPage() {
    return (
        <Suspense
            fallback={
                <div className="min-h-screen bg-background flex items-center justify-center">
                    <Loader2 className="w-6 h-6 text-[color:var(--glow)] animate-spin" />
                </div>
            }
        >
            <DeviceAuthContent />
        </Suspense>
    );
}
