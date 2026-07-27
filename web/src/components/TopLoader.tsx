"use client";

import { useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { PAGE_LOADING_EVENT } from "@/lib/navigate";

function isInternalNavigation(anchor: HTMLAnchorElement) {
    if (anchor.target && anchor.target !== "_self") return false;
    if (anchor.hasAttribute("download")) return false;

    const href = anchor.getAttribute("href");
    if (
        !href ||
        href.startsWith("#") ||
        href.startsWith("mailto:") ||
        href.startsWith("tel:")
    ) {
        return false;
    }

    try {
        const url = new URL(href, window.location.href);
        if (url.origin !== window.location.origin) return false;
        return (
            url.pathname !== window.location.pathname ||
            url.search !== window.location.search
        );
    } catch {
        return false;
    }
}

export function TopLoader() {
    const pathname = usePathname();
    const searchParams = useSearchParams();
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        setLoading(false);
    }, [pathname, searchParams]);

    useEffect(() => {
        const onClick = (event: MouseEvent) => {
            if (
                event.defaultPrevented ||
                event.button !== 0 ||
                event.metaKey ||
                event.ctrlKey ||
                event.shiftKey ||
                event.altKey
            ) {
                return;
            }

            const anchor = (event.target as HTMLElement | null)?.closest("a");
            if (!anchor || !isInternalNavigation(anchor)) return;

            setLoading(true);
        };

        const onStartLoading = () => setLoading(true);
        const onPopState = () => setLoading(true);

        document.addEventListener("click", onClick);
        window.addEventListener(PAGE_LOADING_EVENT, onStartLoading);
        window.addEventListener("popstate", onPopState);
        return () => {
            document.removeEventListener("click", onClick);
            window.removeEventListener(PAGE_LOADING_EVENT, onStartLoading);
            window.removeEventListener("popstate", onPopState);
        };
    }, []);

    if (!loading) return null;

    return (
        <div className="fixed inset-0 z-[99999] flex items-center justify-center bg-background">
            <div className="size-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
    );
}
