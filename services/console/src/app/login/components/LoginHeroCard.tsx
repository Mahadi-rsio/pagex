import { Zap } from "lucide-react";

export function LoginHeroCard() {
    return (
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
    );
}
