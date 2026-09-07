import { Home, Zap } from "lucide-react";
import Link from "next/link";

export function LoginHeader() {
    return (
        <header className="relative z-10 flex items-center justify-between border-b border-border bg-background/60 px-6 py-4 backdrop-blur-md md:px-12">
            <Link
                href="/"
                className="flex items-center gap-2.5 transition-opacity hover:opacity-80"
            >
                <div className="flex size-8 items-center justify-center rounded-none border border-border bg-foreground text-background">
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
    );
}
