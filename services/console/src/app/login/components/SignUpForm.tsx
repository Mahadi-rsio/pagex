"use client";

import { Lock, Mail, User as UserIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";

type SignUpFormProps = {
    name: string;
    email: string;
    password: string;
    isLoading: boolean;
    disabled: boolean;
    onNameChange: (value: string) => void;
    onEmailChange: (value: string) => void;
    onPasswordChange: (value: string) => void;
    onSubmit: (e: React.FormEvent) => void;
};

export function SignUpForm({
    name,
    email,
    password,
    isLoading,
    disabled,
    onNameChange,
    onEmailChange,
    onPasswordChange,
    onSubmit,
}: SignUpFormProps) {
    return (
        <form onSubmit={onSubmit} className="space-y-3">
            <div className="space-y-1.5">
                <Label
                    htmlFor="signup-name"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                    Name
                </Label>
                <div className="relative">
                    <UserIcon className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                        id="signup-name"
                        type="text"
                        placeholder="Jane Doe"
                        value={name}
                        onChange={(e) => onNameChange(e.target.value)}
                        className="rounded-none pl-9"
                        required
                    />
                </div>
            </div>

            <div className="space-y-1.5">
                <Label
                    htmlFor="signup-email"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                    Email
                </Label>
                <div className="relative">
                    <Mail className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                        id="signup-email"
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
                    htmlFor="signup-password"
                    className="text-[11px] uppercase tracking-wider text-muted-foreground"
                >
                    Password
                </Label>
                <div className="relative">
                    <Lock className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                    <Input
                        id="signup-password"
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
                Create Account
            </Button>
        </form>
    );
}
