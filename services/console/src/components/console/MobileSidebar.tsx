"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { getInitials } from "@/lib/utils";
import {
    LayoutDashboard,
    FolderKanban,
    CreditCard,
    Settings,
    HardDrive,
    LogOut,
    Zap,
} from "lucide-react";
import { authClient } from "@/modules/auth/utils/auth-client";

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
        <div className="flex h-full flex-col bg-background p-4">
            {/* Header */}
            <div className="flex items-center gap-2 pb-4 border-b border-border/50">
                <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                    <Zap className="size-4" />
                </div>
                <span className="text-base font-bold tracking-tight text-foreground">
                    Console
                </span>
            </div>

            {/* Nav */}
            <nav className="flex-1 py-4">
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
                                    className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-colors ${
                                        isActive
                                            ? "bg-primary/10 font-medium text-primary"
                                            : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
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

            {/* User Footer */}
            {user && (
                <div className="border-t border-border/50 pt-4 space-y-3">
                    <div className="flex items-center gap-3">
                        <Avatar className="size-9">
                            <AvatarImage src={user.avatarUrl} alt={user.name} />
                            <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
                                {getInitials(user.name)}
                            </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold text-foreground">
                                {user.name}
                            </p>
                            <p className="truncate text-xs text-muted-foreground">
                                {user.email}
                            </p>
                        </div>
                    </div>

                    <Button
                        variant="outline"
                        className="w-full justify-start gap-2 text-destructive hover:text-destructive hover:bg-destructive/10"
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
