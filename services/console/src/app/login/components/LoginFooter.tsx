import Link from "next/link";

export function LoginFooter() {
    return (
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
    );
}
