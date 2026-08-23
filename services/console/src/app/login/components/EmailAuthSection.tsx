"use client";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SignInForm } from "./SignInForm";
import { SignUpForm } from "./SignUpForm";

type EmailAuthSectionProps = {
    signInEmail: string;
    signInPassword: string;
    signUpName: string;
    signUpEmail: string;
    signUpPassword: string;
    isEmailLoading: boolean;
    isAnyLoading: boolean;
    onSignInEmailChange: (value: string) => void;
    onSignInPasswordChange: (value: string) => void;
    onSignUpNameChange: (value: string) => void;
    onSignUpEmailChange: (value: string) => void;
    onSignUpPasswordChange: (value: string) => void;
    onSignIn: (e: React.FormEvent) => void;
    onSignUp: (e: React.FormEvent) => void;
};

export function EmailAuthSection({
    signInEmail,
    signInPassword,
    signUpName,
    signUpEmail,
    signUpPassword,
    isEmailLoading,
    isAnyLoading,
    onSignInEmailChange,
    onSignInPasswordChange,
    onSignUpNameChange,
    onSignUpEmailChange,
    onSignUpPasswordChange,
    onSignIn,
    onSignUp,
}: EmailAuthSectionProps) {
    return (
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
                    <TabsTrigger value="signin" className="rounded-none">
                        Sign In
                    </TabsTrigger>
                    <TabsTrigger value="signup" className="rounded-none">
                        Sign Up
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="signin">
                    <SignInForm
                        email={signInEmail}
                        password={signInPassword}
                        isLoading={isEmailLoading}
                        disabled={isAnyLoading}
                        onEmailChange={onSignInEmailChange}
                        onPasswordChange={onSignInPasswordChange}
                        onSubmit={onSignIn}
                    />
                </TabsContent>

                <TabsContent value="signup">
                    <SignUpForm
                        name={signUpName}
                        email={signUpEmail}
                        password={signUpPassword}
                        isLoading={isEmailLoading}
                        disabled={isAnyLoading}
                        onNameChange={onSignUpNameChange}
                        onEmailChange={onSignUpEmailChange}
                        onPasswordChange={onSignUpPasswordChange}
                        onSubmit={onSignUp}
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
}
