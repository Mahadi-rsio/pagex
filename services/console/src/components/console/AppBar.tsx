"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { authClient } from "@/modules/auth/utils/auth-client";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuGroup,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { MobileSidebar } from "@/components/console/MobileSidebar";
import { getInitials } from "@/lib/utils";
import { LogOut, User, Sun, Moon, Menu, Plus, Search, Zap } from "lucide-react";

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
        <header className="sticky top-0 z-50 w-full border-b border-border/50 bg-background/80 backdrop-blur-xl">
            <div className="flex h-14 items-center gap-3 px-4">
                {/* Left: mobile menu + desktop logo */}
                <div className="flex shrink-0 items-center gap-2">
                    <div className="md:hidden">
                        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
                            <SheetTrigger asChild>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-9"
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
                        className="hidden items-center gap-2 font-semibold text-foreground transition-opacity hover:opacity-80 md:flex"
                    >
                        <div className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                            <Zap className="size-4" />
                        </div>
                        <span className="text-sm font-bold tracking-tight">
                            Console
                        </span>
                    </Link>
                </div>

                {/* Center: search */}
                <div className="hidden min-w-0 flex-1 md:flex md:justify-center">
                    <div className="relative w-full max-w-md">
                        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
                        <Input
                            type="search"
                            placeholder="Search projects, domains..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="h-8 bg-muted/50 pl-8"
                        />
                    </div>
                </div>

                <div className="flex-1 md:hidden" />

                {/* Right: actions */}
                <div className="flex shrink-0 items-center gap-2">
                    <Link
                        href="/billing"
                        className="flex items-center gap-1.5 rounded-full border border-border bg-muted/50 py-1 pl-3 pr-1.5 text-xs font-medium hover:bg-muted transition-colors"
                    >
                        <span className="font-semibold text-foreground">
                            ${balance.toFixed(2)}
                        </span>
                        <span className="flex size-5 items-center justify-center rounded-full bg-foreground text-background">
                            <Plus className="size-3" />
                        </span>
                    </Link>

                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="ghost"
                                size="icon"
                                className="relative size-8 rounded-full p-0 ring-2 ring-border hover:ring-foreground/30 transition-all"
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
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            sideOffset={8}
                            className="w-64"
                        >
                            <DropdownMenuGroup>
                                <DropdownMenuLabel className="font-normal">
                                    <div className="flex items-center gap-3 py-1">
                                        <Avatar className="size-9">
                                            <AvatarImage
                                                src={user.avatarUrl}
                                                alt={user.name}
                                            />
                                            <AvatarFallback className="bg-muted text-xs font-semibold text-foreground">
                                                {getInitials(user.name)}
                                            </AvatarFallback>
                                        </Avatar>
                                        <div className="min-w-0 flex-1">
                                            <p className="truncate text-sm font-semibold text-foreground">
                                                {user.name}
                                            </p>
                                            <p className="truncate text-sm text-muted-foreground">
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
