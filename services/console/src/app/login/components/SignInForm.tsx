"use client";

import { Lock, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type SignInFormProps = {
    email: string;
    password: string;
    isLoading: boolean;
    disabled: boolean;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
};

export function SignInForm({
    email,
    password,
    isLoading,
    disabled,
    onEmailChange,
    onPasswordChange,
    onSubmit,
}: SignInFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
                <Label
                    htmlFor="signin-email"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                    Email
                </Label>
                <div className="relative">
                    <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                        id="signin-email"
                        type="email"
                        placeholder="name@example.com"
                        value={email}
                        onChange={(e) => onEmailChange(e.target.value)}
                        className="rounded-none pl-9"
                        required
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label
                    htmlFor="signin-password"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                    Password
                </Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                        id="signin-password"
                        type="password"
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => onPasswordChange(e.target.value)}
                        className="rounded-none pl-9"
                        required
                    />
                </div>
            </div>

            <Button
                type="submit"
                className="mt-2 w-full rounded-none"
                disabled={disabled}
            >
                {isLoading ? (
                    <Spinner size="inline" className="mr-2" />
                ) : null}
                Sign In
            </Button>
        </form>
    );
}
