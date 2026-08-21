"use client";

import { Github, Home, Lock, Mail, User as UserIcon, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import { authClient } from "@/modules/auth/utils/auth-client";

const getCallbackUrl = () => {
    if (typeof window !== "undefined") {
        const hostname = window.location.hostname;
        if (hostname === "localhost" || hostname === "127.0.0.1") {
            return window.location.origin;
        }
    }
    return (
        process.env.PUBLIC_URL ||
        (typeof window !== "undefined"
            ? window.location.origin
            : "http://localhost:3000")
    );
};

export function LoginPage() {
    const router = useRouter();
    const [isGithubLoading, setIsGithubLoading] = useState(false);
    const [isGoogleLoading, setIsGoogleLoading] = useState(false);
    const [isEmailLoading, setIsEmailLoading] = useState(false);

    const [signInEmail, setSignInEmail] = useState("");
    const [signInPassword, setSignInPassword] = useState("");
    const [signUpName, setSignUpName] = useState("");
    const [signUpEmail, setSignUpEmail] = useState("");
    const [signUpPassword, setSignUpPassword] = useState("");

    const isEmailAuthEnabled =
        process.env.NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD !== "false";

    const isAnyLoading = isGithubLoading || isGoogleLoading || isEmailLoading;

    const handleGithubSignIn = async () => {
        setIsGithubLoading(true);
        try {
            const { error } = await authClient.signIn.social({
                provider: "github",
                callbackURL: getCallbackUrl(),
            });
            if (error) {
                toast.error(error.message ?? "GitHub sign-in failed");
                setIsGithubLoading(false);
            }
        } catch (err: any) {
            toast.error(err.message ?? "An unexpected error occurred");
            setIsGithubLoading(false);
        }
    };

    const handleGoogleSignIn = async () => {
        setIsGoogleLoading(true);
        try {
            const { error } = await authClient.signIn.social({
                provider: "google",
                callbackURL: getCallbackUrl(),
            });
            if (error) {
                toast.error(error.message ?? "Google sign-in failed");
                setIsGoogleLoading(false);
            }
        } catch (err: any) {
            toast.error(err.message ?? "An unexpected error occurred");
            setIsGoogleLoading(false);
        }
    };

    const handleEmailSignIn = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!signInEmail || !signInPassword) {
            toast.error("Please fill in all fields");
            return;
        }

        setIsEmailLoading(true);
        try {
            const { error } = await authClient.signIn.email({
                email: signInEmail,
                password: signInPassword,
                callbackURL: getCallbackUrl(),
            });

            if (error) {
                toast.error(error.message ?? "Failed to sign in");
                setIsEmailLoading(false);
            } else {
                toast.success("Signed in successfully!");
                router.push("/");
                router.refresh();
            }
        } catch (err: any) {
            toast.error(err.message ?? "An unexpected error occurred");
            setIsEmailLoading(false);
        }
    };

    const handleEmailSignUp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!signUpName || !signUpEmail || !signUpPassword) {
            toast.error("Please fill in all fields");
            return;
        }

        setIsEmailLoading(true);
        try {
            const { error } = await authClient.signUp.email({
                name: signUpName,
                email: signUpEmail,
                password: signUpPassword,
                callbackURL: getCallbackUrl(),
            });

            if (error) {
                toast.error(error.message ?? "Failed to sign up");
                setIsEmailLoading(false);
            } else {
                toast.success("Account created successfully!");
                router.push("/");
                router.refresh();
            }
        } catch (err: any) {
            toast.error(err.message ?? "An unexpected error occurred");
            setIsEmailLoading(false);
        }
    };

    return (
        <div className="relative flex min-h-screen flex-col justify-between overflow-hidden bg-background text-foreground antialiased">
            <AnimatedGridPattern
                numSquares={28}
                maxOpacity={0.05}
                duration={3}
                repeatDelay={1}
                className={cn(
                    "[mask-image:radial-gradient(520px_circle_at_center,white,transparent)]",
                    "inset-x-0 inset-y-[-30%] h-[160%] skew-y-12",
                    "fill-foreground/5 stroke-foreground/5",
                )}
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-grid opacity-40"
            />
            <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-foreground/20 to-transparent"
            />

            <header className="relative z-10 flex items-center justify-between border-b border-border/50 bg-background/60 px-6 py-4 backdrop-blur-md md:px-12">
                <Link
                    href="/"
                    className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
                >
                    <div className="edge-frame edge-frame-sm flex size-8 items-center justify-center border border-border bg-foreground text-background">
                        <Zap className="size-3.5" strokeWidth={2.25} />
                    </div>
                    <div className="flex flex-col leading-none">
                        <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                            Cloudisy
                        </span>
                        <span className="text-sm font-bold tracking-tight">
                            Console
                        </span>
                    </div>
                </Link>
                <Link
                    href="/"
                    className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
                >
                    <Home className="size-3.5" />
                    Home
                </Link>
            </header>

            <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
                <div className="surface-hud edge-frame w-full max-w-[400px] space-y-6 p-6 sm:p-8">
                    <div className="relative z-[1] flex flex-col items-center space-y-3 text-center">
                        <div className="edge-frame edge-frame-sm flex size-12 items-center justify-center border border-border bg-foreground text-background">
                            <Zap className="size-5" strokeWidth={2.25} />
                        </div>
                        <div className="space-y-1">
                            <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                                Access Gate
                            </span>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                Welcome Back
                            </h1>
                            <p className="text-sm text-muted-foreground">
                                Sign in to manage projects and deployments.
                            </p>
                        </div>
                    </div>

                    <div className="relative z-[1] space-y-4">
                        <div className="space-y-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 w-full gap-2.5 rounded-none"
                                onClick={handleGoogleSignIn}
                                disabled={isAnyLoading}
                            >
                                {isGoogleLoading ? (
                                    <Spinner size="inline" />
                                ) : (
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="16"
                                        height="16"
                                        xmlns="http://www.w3.org/2000/svg"
                                        aria-hidden
                                        className="text-foreground"
                                    >
                                        <path
                                            fill="currentColor"
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                        />
                                        <path
                                            fill="currentColor"
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            opacity="0.85"
                                        />
                                        <path
                                            fill="currentColor"
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                                            opacity="0.7"
                                        />
                                        <path
                                            fill="currentColor"
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                                            opacity="0.55"
                                        />
                                    </svg>
                                )}
                                <span>Continue with Google</span>
                            </Button>

                            <Button
                                type="button"
                                variant="outline"
                                className="h-10 w-full gap-2.5 rounded-none"
                                onClick={handleGithubSignIn}
                                disabled={isAnyLoading}
                            >
                                {isGithubLoading ? (
                                    <Spinner size="inline" />
                                ) : (
                                    <Github className="size-4" />
                                )}
                                <span>Continue with GitHub</span>
                            </Button>
                        </div>

                        {isEmailAuthEnabled && (
                            <div className="pt-1">
                                <div className="relative my-4">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-border" />
                                    </div>
                                    <div className="relative flex justify-center text-[10px] uppercase tracking-[0.18em]">
                                        <span className="bg-popover px-2 text-muted-foreground">
                                            Or email
                                        </span>
                                    </div>
                                </div>

                                <Tabs defaultValue="signin" className="w-full">
                                    <TabsList className="mb-4 grid w-full grid-cols-2 rounded-none">
                                        <TabsTrigger
                                            value="signin"
                                            className="rounded-none"
                                        >
                                            Sign In
                                        </TabsTrigger>
                                        <TabsTrigger
                                            value="signup"
                                            className="rounded-none"
                                        >
                                            Sign Up
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="signin">
                                        <form
                                            onSubmit={handleEmailSignIn}
                                            className="space-y-3"
                                        >
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
                                                        value={signInEmail}
                                                        onChange={(e) =>
                                                            setSignInEmail(
                                                                e.target.value,
                                                            )
                                                        }
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
                                                        value={signInPassword}
                                                        onChange={(e) =>
                                                            setSignInPassword(
                                                                e.target.value,
                                                            )
                                                        }
                                                        className="rounded-none pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                className="mt-2 w-full rounded-none"
                                                disabled={isAnyLoading}
                                            >
                                                {isEmailLoading ? (
                                                    <Spinner
                                                        size="inline"
                                                        className="mr-2"
                                                    />
                                                ) : null}
                                                Sign In
                                            </Button>
                                        </form>
                                    </TabsContent>

                                    <TabsContent value="signup">
                                        <form
                                            onSubmit={handleEmailSignUp}
                                            className="space-y-3"
                                        >
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
                                                        value={signUpName}
                                                        onChange={(e) =>
                                                            setSignUpName(
                                                                e.target.value,
                                                            )
                                                        }
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
                                                        value={signUpEmail}
                                                        onChange={(e) =>
                                                            setSignUpEmail(
                                                                e.target.value,
                                                            )
                                                        }
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
                                                        value={signUpPassword}
                                                        onChange={(e) =>
                                                            setSignUpPassword(
                                                                e.target.value,
                                                            )
                                                        }
                                                        className="rounded-none pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                className="mt-2 w-full rounded-none"
                                                disabled={isAnyLoading}
                                            >
                                                {isEmailLoading ? (
                                                    <Spinner
                                                        size="inline"
                                                        className="mr-2"
                                                    />
                                                ) : null}
                                                Create Account
                                            </Button>
                                        </form>
                                    </TabsContent>
                                </Tabs>
                            </div>
                        )}
                    </div>
                </div>
            </main>

            <footer className="relative z-10 flex justify-center gap-4 border-t border-border/50 bg-background/60 py-6 text-center text-xs text-muted-foreground backdrop-blur-md">
                <Link
                    href="/privacy"
                    className="transition-colors hover:text-foreground hover:underline"
                >
                    Privacy Policy
                </Link>
                <span>&middot;</span>
                <Link
                    href="/terms"
                    className="transition-colors hover:text-foreground hover:underline"
                >
                    Terms of Service
                </Link>
            </footer>
        </div>
    );
}
