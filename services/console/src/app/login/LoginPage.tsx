"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatedGridPattern } from "@/components/ui/animated-grid-pattern";
import { cn } from "@/lib/utils";
import { authClient } from "@/modules/auth/utils/auth-client";
import { getCallbackUrl } from "./components/getCallbackUrl";
import { LoginHeader } from "./components/LoginHeader";
import { LoginHeroCard } from "./components/LoginHeroCard";
import { LoginFooter } from "./components/LoginFooter";
import { SocialAuthButtons } from "./components/SocialAuthButtons";
import { EmailAuthSection } from "./components/EmailAuthSection";

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
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "An unexpected error occurred";
            toast.error(message);
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
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "An unexpected error occurred";
            toast.error(message);
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
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "An unexpected error occurred";
            toast.error(message);
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
        } catch (err: unknown) {
            const message =
                err instanceof Error ? err.message : "An unexpected error occurred";
            toast.error(message);
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

            <LoginHeader />

            <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
                <div className="surface-hud edge-frame w-full max-w-[400px] space-y-6 p-6 sm:p-8">
                    <LoginHeroCard />

                    <div className="relative z-[1] space-y-4">
                        <SocialAuthButtons
                            isGithubLoading={isGithubLoading}
                            isGoogleLoading={isGoogleLoading}
                            disabled={isAnyLoading}
                            onGithubSignIn={handleGithubSignIn}
                            onGoogleSignIn={handleGoogleSignIn}
                        />

                        {isEmailAuthEnabled && (
                            <EmailAuthSection
                                signInEmail={signInEmail}
                                signInPassword={signInPassword}
                                signUpName={signUpName}
                                signUpEmail={signUpEmail}
                                signUpPassword={signUpPassword}
                                isEmailLoading={isEmailLoading}
                                isAnyLoading={isAnyLoading}
                                onSignInEmailChange={setSignInEmail}
                                onSignInPasswordChange={setSignInPassword}
                                onSignUpNameChange={setSignUpName}
                                onSignUpEmailChange={setSignUpEmail}
                                onSignUpPasswordChange={setSignUpPassword}
                                onSignIn={handleEmailSignIn}
                                onSignUp={handleEmailSignUp}
                            />
                        )}
                    </div>
                </div>
            </main>

            <LoginFooter />
        </div>
    );
}
