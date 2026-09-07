"use client";

import { LogOut, Menu, Moon, Plus, Search, Sun, User, Zap } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { MobileSidebar } from "@/components/console/MobileSidebar";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { getInitials } from "@/lib/utils";
import { authClient } from "@/modules/auth/utils/auth-client";
import { useAppStore } from "@/store/useAppStore";

export function AppBar() {
    const { user, balance, theme, setTheme } = useAppStore();
    const router = useRouter();
    const [mobileOpen, setMobileOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");

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
        <header className="sticky top-0 z-50 w-full border-b border-border bg-background">
            <div className="relative flex h-14 items-center gap-3 px-4">
                {/* Left: mobile menu + desktop logo */}
                <div className="flex shrink-0 items-center gap-2.5">
                    <div className="md:hidden">
                        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                            <SheetTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9 border border-transparent hover:border-border"
                                >
                                    <Menu className="size-4" />
                                </Button>
                            </SheetTrigger>
                            <SheetContent side="left" className="w-72 p-0">
                                <MobileSidebar
                                    onClose={() => setMobileOpen(false)}
                                />
                            </SheetContent>
                        </Sheet>
                    </div>

                    <Link
                        href="/"
                        className="group hidden items-center gap-2.5 font-semibold text-foreground transition-opacity hover:opacity-90 md:flex"
                    >
                        <div className="relative flex size-8 items-center justify-center rounded-none border border-border bg-foreground text-background transition-colors group-hover:bg-foreground/90">
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
                </div>

                {/* Center: search */}
                <div className="hidden min-w-0 flex-1 md:flex md:justify-center">
                    <div className="relative w-full max-w-md">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 z-[1] size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search projects, domains..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 border-border bg-muted/30 pl-8 focus-visible:border-foreground/35 focus-visible:ring-0"
                        />
                    </div>
                </div>

                <div className="flex-1 md:hidden" />

                {/* Right: actions */}
                <div className="flex shrink-0 items-center gap-2">
                    <Link
                        href="/billing"
                        className="group flex items-center gap-1.5 rounded-none border border-border bg-muted/40 py-1 pl-3 pr-1.5 text-xs font-medium transition-colors hover:bg-muted"
                    >
                        <span className="font-mono text-[11px] tracking-tight text-muted-foreground">
                            BAL
                        </span>
                        <span className="font-semibold tabular-nums text-foreground">
                            ${balance.toFixed(2)}
                        </span>
                        <span className="flex size-5 items-center justify-center rounded-none border border-border bg-foreground text-background transition-transform group-hover:scale-105">
                            <Plus className="size-3" strokeWidth={2.5} />
                        </span>
                    </Link>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative size-8 rounded-none border border-border p-0 transition-colors hover:bg-muted/60"
                            >
                                <Avatar className="size-full rounded-none">
                                    <AvatarImage
                                        src={user.avatarUrl}
                                        alt={user.name}
                                        className="rounded-none"
                                    />
                                    <AvatarFallback className="rounded-none bg-muted text-[10px] font-semibold tracking-wide text-foreground">
                                        {getInitials(user.name)}
                                    </AvatarFallback>
                                </Avatar>
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            sideOffset={10}
                            className="w-64"
                        >
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="font-normal">
                                    <div className="flex items-center gap-3 py-1">
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
                                </DropdownMenuLabel>
                            </DropdownMenuGroup>

                            <DropdownMenuSeparator />

                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onClick={() => router.push("/settings")}
                                >
                                    <User className="size-4 text-muted-foreground" />
                                    Profile & Settings
                                </DropdownMenuItem>

                                <DropdownMenuItem
                                    className="cursor-pointer gap-2"
                                    onClick={() =>
                                        setTheme(
                                            theme === "dark" ? "light" : "dark",
                                        )
                                    }
                                >
                                    {theme === "dark" ? (
                                        <Sun className="size-4 text-muted-foreground" />
                                    ) : (
                                        <Moon className="size-4 text-muted-foreground" />
                                    )}
                                    {theme === "dark"
                                        ? "Light mode"
                                        : "Dark mode"}
                                </DropdownMenuItem>
                            </DropdownMenuGroup>

                            <DropdownMenuSeparator />

                            <DropdownMenuGroup>
                                <DropdownMenuItem
                                    variant="destructive"
                                    className="cursor-pointer gap-2"
                                    onClick={handleSignOut}
                                >
                                    <LogOut className="size-4" />
                                    Log out
                                </DropdownMenuItem>
                            </DropdownMenuGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            </div>
        </header>
    );
}
