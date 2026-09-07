"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { authClient } from "@/modules/auth/utils/auth-client";
import { AppBar } from "@/components/console/AppBar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { getInitials } from "@/lib/utils";
import {
    LayoutDashboard,
    FolderKanban,
    CreditCard,
    Settings,
    LogOut,
    ChevronUp,
} from "lucide-react";

interface LayoutProps {
    children: React.ReactNode;
}

const navItems = [
    { label: "Dashboard", href: "/", icon: LayoutDashboard },
    { label: "Projects", href: "/projects", icon: FolderKanban },
    { label: "Billing", href: "/billing", icon: CreditCard },
    { label: "Settings", href: "/settings", icon: Settings },
];

export function Layout({ children }: LayoutProps) {
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

    if (!user) return null;

    return (
        <div className="flex h-svh flex-col overflow-hidden bg-background">
            <AppBar />
            <div className="flex min-h-0 flex-1">
                {/* Desktop Sidebar — stays fixed while main content scrolls */}
                <aside className="hidden w-56 shrink-0 flex-col overflow-y-auto border-r border-border bg-background/50 md:flex">
                    <nav className="flex-1 px-3 py-4">
                        <ul className="space-y-0.5">
                            {navItems.map(({ label, href, icon: Icon }) => {
                                const isActive =
                                    pathname === href ||
                                    (href !== "/" && pathname.startsWith(href));
                                return (
                                    <li key={href}>
                                        <Link
                                            href={href}
                                            className={`flex w-full items-center gap-2.5 rounded-none px-3 py-2 text-sm transition-all ${
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

                    {/* Account section */}
                    <div className="border-t border-border p-3">
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    type="button"
                                    className="flex w-full items-center gap-2.5 rounded-none px-1 py-1.5 text-left outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                                >
                                    <Avatar className="size-8">
                                        <AvatarImage
                                            src={user.avatarUrl}
                                            alt={user.name}
                                        />
                                        <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
                                            {getInitials(user.name)}
                                        </AvatarFallback>
                                    </Avatar>
                                    <div className="min-w-0 flex-1">
                                        <p className="truncate text-xs font-semibold text-foreground">
                                            {user.name}
                                        </p>
                                        <p className="truncate text-xs text-muted-foreground">
                                            {user.email}
                                        </p>
                                    </div>
                                    <ChevronUp className="size-3.5 shrink-0 text-muted-foreground" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                                side="top"
                                align="start"
                                sideOffset={8}
                                className="w-52"
                            >
                                <DropdownMenuItem
                                    asChild
                                    className="cursor-pointer gap-2"
                                >
                                    <Link href="/settings">
                                        <Settings className="size-4 text-muted-foreground" />
                                        Settings
                                    </Link>
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    variant="destructive"
                                    className="cursor-pointer gap-2"
                                    onClick={handleSignOut}
                                >
                                    <LogOut className="size-4" />
                                    Log out
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </aside>

                {/* Main Content */}
                <main className="min-w-0 flex-1 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}
