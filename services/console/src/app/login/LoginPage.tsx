"use client";

import Link from "next/link";
import { useState } from "react";
import {
    Github,
    Loader2,
    Home,
    Mail,
    Lock,
    User as UserIcon,
} from "lucide-react";
import { authClient } from "@/modules/auth/utils/auth-client";
import Image from "next/image";
import toast from "react-hot-toast";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useRouter } from "next/navigation";

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

    // Form states
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
        <div className="min-h-screen bg-background text-foreground antialiased flex flex-col justify-between relative overflow-hidden">
            {/* Animated grid background */}
            <AnimatedGridPattern
                numSquares={30}
                maxOpacity={0.04}
                duration={3}
                repeatDelay={1}
                className={cn(
                    "[mask-image:radial-gradient(500px_circle_at_center,white,transparent)]",
                    "inset-x-0 inset-y-[-30%] h-[160%] skew-y-12",
                    "fill-foreground/5 stroke-foreground/5",
                )}
            />

            <header className="relative z-10 flex items-center justify-between px-6 py-4 md:px-12 border-b border-border/10 bg-background/50">
                <Link
                    href="/"
                    className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors duration-150"
                >
                    <Home className="h-4 w-4" />
                    <span>Home</span>
                </Link>
            </header>

            <main className="flex flex-1 items-center justify-center px-4 py-12 relative z-10">
                <div className="w-full max-w-[380px] space-y-6">
                    <div className="flex flex-col items-center justify-center space-y-3">
                        <Image
                            src="/logo.png"
                            width={48}
                            height={48}
                            alt="Cloudisy logo"
                            className="object-contain"
                        />
                        <div className="text-center space-y-1">
                            <span className="text-xs font-semibold text-muted-foreground tracking-wider uppercase">
                                Cloudisy Console
                            </span>
                            <h1 className="text-2xl font-bold tracking-tight text-foreground">
                                Welcome Back
                            </h1>
                        </div>
                    </div>

                    <div className="space-y-4">
                        {/* Social Auth Buttons */}
                        <div className="space-y-2.5">
                            <Button
                                type="button"
                                variant="outline"
                                className="w-full h-10 flex items-center justify-center gap-2.5"
                                onClick={handleGoogleSignIn}
                                disabled={isAnyLoading}
                            >
                                {isGoogleLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                    <svg
                                        viewBox="0 0 24 24"
                                        width="16"
                                        height="16"
                                        xmlns="http://www.w3.org/2000/svg"
                                    >
                                        <path
                                            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                            fill="#4285F4"
                                        />
                                        <path
                                            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                            fill="#34A853"
                                        />
                                        <path
                                            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                                            fill="#FBBC05"
                                        />
                                        <path
                                            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                                            fill="#EA4335"
                                        />
                                    </svg>
                                )}
                                <span>Continue with Google</span>
                            </Button>

                            <Button
                                type="button"
                                variant="outline"
                                className="w-full h-10 flex items-center justify-center gap-2.5"
                                onClick={handleGithubSignIn}
                                disabled={isAnyLoading}
                            >
                                {isGithubLoading ? (
                                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                                ) : (
                                    <Github className="h-4 w-4" />
                                )}
                                <span>Continue with GitHub</span>
                            </Button>
                        </div>

                        {/* Email & Password Authentication Section */}
                        {isEmailAuthEnabled && (
                            <div className="pt-2">
                                <div className="relative my-4">
                                    <div className="absolute inset-0 flex items-center">
                                        <span className="w-full border-t border-border/50" />
                                    </div>
                                    <div className="relative flex justify-center text-xs uppercase">
                                        <span className="bg-background px-2 text-muted-foreground">
                                            Or email & password
                                        </span>
                                    </div>
                                </div>

                                <Tabs defaultValue="signin" className="w-full">
                                    <TabsList className="grid w-full grid-cols-2 mb-4">
                                        <TabsTrigger value="signin">
                                            Sign In
                                        </TabsTrigger>
                                        <TabsTrigger value="signup">
                                            Sign Up
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="signin">
                                        <form
                                            onSubmit={handleEmailSignIn}
                                            className="space-y-3"
                                        >
                                            <div className="space-y-1">
                                                <Label
                                                    htmlFor="signin-email"
                                                    className="text-xs"
                                                >
                                                    Email
                                                </Label>
                                                <div className="relative">
                                                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                                        className="pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1">
                                                <Label
                                                    htmlFor="signin-password"
                                                    className="text-xs"
                                                >
                                                    Password
                                                </Label>
                                                <div className="relative">
                                                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                                        className="pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                className="w-full mt-2"
                                                disabled={isAnyLoading}
                                            >
                                                {isEmailLoading ? (
                                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
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
                                            <div className="space-y-1">
                                                <Label
                                                    htmlFor="signup-name"
                                                    className="text-xs"
                                                >
                                                    Name
                                                </Label>
                                                <div className="relative">
                                                    <UserIcon className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                                        className="pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1">
                                                <Label
                                                    htmlFor="signup-email"
                                                    className="text-xs"
                                                >
                                                    Email
                                                </Label>
                                                <div className="relative">
                                                    <Mail className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                                        className="pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <div className="space-y-1">
                                                <Label
                                                    htmlFor="signup-password"
                                                    className="text-xs"
                                                >
                                                    Password
                                                </Label>
                                                <div className="relative">
                                                    <Lock className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
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
                                                        className="pl-9"
                                                        required
                                                    />
                                                </div>
                                            </div>

                                            <Button
                                                type="submit"
                                                className="w-full mt-2"
                                                disabled={isAnyLoading}
                                            >
                                                {isEmailLoading ? (
                                                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
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

            <footer className="py-6 border-t border-border/10 text-center flex justify-center gap-4 text-xs text-muted-foreground bg-background/50">
                <Link
                    href="/privacy"
                    className="hover:underline hover:text-foreground transition-colors"
                >
                    Privacy Policy
                </Link>
                <span>&middot;</span>
                <Link
                    href="/terms"
                    className="hover:underline hover:text-foreground transition-colors"
                >
                    Terms of Service
                </Link>
            </footer>
        </div>
    );
}
