"use client";

import {
    CreditCard,
    FolderKanban,
    HardDrive,
    LayoutDashboard,
    LogOut,
    Settings,
    Zap,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
import { authClient } from "@/modules/auth/utils/auth-client";
import { useAppStore } from "@/store/useAppStore";

interface MobileSidebarProps {
    onClose: () => void;
}

const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
    { label: "Projects", href: "/projects", icon: FolderKanban },
    { label: "Billing", href: "/billing", icon: CreditCard },
    { label: "Storage", href: "/storage", icon: HardDrive },
    { label: "Settings", href: "/settings", icon: Settings },
];

export function MobileSidebar({ onClose }: MobileSidebarProps) {
    const pathname = usePathname();
    const { user } = useAppStore();

    const handleSignOut = async () => {
        await authClient.signOut({
            fetchOptions: {
                onSuccess: () => {
                    window.location.href = "/login";
                },
            },
        });
    };

    return (
        <div className="relative flex h-full flex-col bg-background">
            <div
                aria-hidden
                className="pointer-events-none absolute inset-0 bg-grid opacity-30"
            />

            <div className="relative flex items-center gap-2.5 border-b border-border px-4 py-4">
                <div className="flex size-8 items-center justify-center border border-border bg-foreground text-background">
                    <Zap className="size-3.5" strokeWidth={2.25} />
                </div>
                <div className="flex flex-col leading-none">
                    <span className="text-[10px] font-medium uppercase tracking-[0.22em] text-muted-foreground">
                        Cloudisy
                    </span>
                    <span className="text-sm font-bold tracking-tight text-foreground">
                        Console
                    </span>
                </div>
            </div>

            <nav className="relative flex-1 overflow-y-auto px-3 py-4">
                <ul className="space-y-1">
                    {navItems.map(({ label, href, icon: Icon }) => {
                        const isActive =
                            pathname === href ||
                            (href !== "/" && pathname.startsWith(href));
                        return (
                            <li key={href}>
                                <Link
                                    href={href}
                                    onClick={onClose}
                                    className={`flex w-full items-center gap-3 rounded-none border px-3 py-2.5 text-sm transition-colors ${
                                        isActive
                                            ? "border-border bg-foreground text-background"
                                            : "border-transparent text-muted-foreground hover:border-border hover:bg-muted/50 hover:text-foreground"
                                    }`}
                                >
                                    <Icon className="size-4 shrink-0" />
                                    {label}
                                </Link>
                            </li>
                        );
                    })}
                </ul>
            </nav>

            {user && (
                <div className="relative space-y-3 border-t border-border px-4 py-4">
                    <div className="flex items-center gap-3">
                        <Avatar className="size-9 rounded-none border border-border">
                            <AvatarImage
                                src={user.avatarUrl}
                                alt={user.name}
                                className="rounded-none"
                            />
                            <AvatarFallback className="rounded-none bg-muted text-xs font-semibold text-foreground">
                                {getInitials(user.name)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold tracking-tight text-foreground">
                                {user.name}
                            </p>
                            <p className="truncate font-mono text-[11px] text-muted-foreground">
                                {user.email}
                            </p>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2 rounded-none text-destructive hover:bg-destructive/10 hover:text-destructive"
                        onClick={handleSignOut}
                    >
                        <LogOut className="size-4" />
                        Log out
                    </Button>
                </div>
            )}
        </div>
    );
}
