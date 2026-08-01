"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { navigateToProjectOverview } from "@/lib/navigate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
    FolderKanban,
    Activity,
    Wallet,
    TrendingUp,
    Plus,
    ArrowRight,
    GitBranch,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Clock,
    HardDrive,
    Zap,
} from "lucide-react";

const statusConfig = {
    active: {
        label: "Active",
        variant: "default" as const,
        icon: CheckCircle2,
        color: "text-emerald-500",
    },
    building: {
        label: "Building",
        variant: "secondary" as const,
        icon: Loader2,
        color: "text-blue-500",
    },
    error: {
        label: "Error",
        variant: "destructive" as const,
        icon: AlertCircle,
        color: "text-destructive",
    },
    inactive: {
        label: "Inactive",
        variant: "outline" as const,
        icon: Clock,
        color: "text-muted-foreground",
    },
};

const activityIcons = {
    deploy: { icon: GitBranch, color: "bg-emerald-500/10 text-emerald-500" },
    build: { icon: Zap, color: "bg-blue-500/10 text-blue-500" },
    error: { icon: AlertCircle, color: "bg-destructive/10 text-destructive" },
    create: { icon: Plus, color: "bg-muted text-muted-foreground" },
    delete: { icon: AlertCircle, color: "bg-muted text-muted-foreground" },
};

export function DashboardView() {
    const { user, balance, projects, activities } = useAppStore();
    const router = useRouter();

    const activeProjects = projects.filter((p) => p.status === "active").length;
    const totalStorage = 0;
    const storageLimit = 10;
    const usagePercent = 0;

    if (!user) return null;

    return (
        <div className="p-6 space-y-6">
            {/* Welcome */}
            <div>
                <h1 className="text-2xl font-bold text-foreground">
                    Welcome back, {user.name.split(" ")[0]} 👋
                </h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Here's what's happening with your projects today.
                </p>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                                <FolderKanban className="size-4.5 text-foreground" />
                            </div>
                            <TrendingUp className="size-4 text-muted-foreground" />
                        </div>
                        <p className="text-2xl font-bold text-foreground">
                            {projects.length}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Total Projects
                        </p>
                        <p className="text-sm text-muted-foreground mt-1 font-medium">
                            {activeProjects} active
                        </p>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                                <Wallet className="size-4.5 text-foreground" />
                            </div>
                            <TrendingUp className="size-4 text-muted-foreground" />
                        </div>
                        <p className="text-2xl font-bold text-foreground">
                            ${balance.toFixed(2)}
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Available Balance
                        </p>
                        <Link
                            href="/billing"
                            className="text-sm text-muted-foreground hover:text-foreground mt-1 font-medium block"
                        >
                            Add funds →
                        </Link>
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                                <HardDrive className="size-4.5 text-foreground" />
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-foreground">
                            {totalStorage}GB
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Storage Used
                        </p>
                        <Progress
                            value={(totalStorage / storageLimit) * 100}
                            className="h-1 mt-2"
                        />
                    </CardContent>
                </Card>

                <Card>
                    <CardContent className="p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div className="size-9 rounded-lg bg-muted flex items-center justify-center">
                                <Activity className="size-4.5 text-foreground" />
                            </div>
                        </div>
                        <p className="text-2xl font-bold text-foreground">
                            {usagePercent}%
                        </p>
                        <p className="text-sm text-muted-foreground mt-0.5">
                            Compute Usage
                        </p>
                        <Progress value={usagePercent} className="h-1 mt-2" />
                    </CardContent>
                </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Projects */}
                <Card className="lg:col-span-2">
                    <CardHeader className="flex flex-row items-center justify-between pb-4">
                        <CardTitle className="text-base font-semibold">
                            Recent Projects
                        </CardTitle>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="text-xs gap-1"
                            onClick={() => router.push("/projects")}
                        >
                            View all <ArrowRight className="size-3" />
                        </Button>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {projects.length === 0 ? (
                            <div className="text-center py-8">
                                <FolderKanban className="size-10 text-muted-foreground/40 mx-auto mb-3" />
                                <p className="text-sm text-muted-foreground">
                                    No projects yet
                                </p>
                                <Button
                                    size="sm"
                                    className="mt-3 gap-2"
                                    onClick={() => router.push("/projects/new")}
                                >
                                    <Plus className="size-3.5" /> Create Project
                                </Button>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {projects.slice(0, 4).map((project) => {
                                    const status = statusConfig[project.status];
                                    const StatusIcon = status.icon;
                                    return (
                                        <button
                                            key={project.id}
                                            onClick={() =>
                                                navigateToProjectOverview(
                                                    project.id,
                                                )
                                            }
                                            className="w-full flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/50 transition-all group text-left cursor-pointer"
                                        >
                                            <div className="size-9 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                                <FolderKanban className="size-4 text-foreground" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-sm font-medium text-foreground truncate">
                                                    {project.name}
                                                </p>
                                                <p className="text-xs text-muted-foreground truncate">
                                                    {project.domain ||
                                                        project.repo ||
                                                        "No domain"}
                                                </p>
                                            </div>
                                            <div className="flex items-center gap-2 shrink-0">
                                                <StatusIcon
                                                    className={`size-4 ${status.color} ${project.status === "building" ? "animate-spin" : ""}`}
                                                />
                                                <Badge
                                                    variant={status.variant}
                                                    className="text-xs"
                                                >
                                                    {status.label}
                                                </Badge>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>

                {/* Recent Activity */}
                <Card>
                    <CardHeader className="pb-4">
                        <CardTitle className="text-base font-semibold">
                            Recent Activity
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                        {activities.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">
                                No recent activity
                            </p>
                        ) : (
                            <div className="space-y-3">
                                {activities.slice(0, 6).map((activity) => {
                                    const { icon: Icon, color } =
                                        activityIcons[activity.type];
                                    return (
                                        <div
                                            key={activity.id}
                                            className="flex items-start gap-3"
                                        >
                                            <div
                                                className={`size-7 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${color}`}
                                            >
                                                <Icon className="size-3.5" />
                                            </div>
                                            <div className="min-w-0 flex-1">
                                                <p className="text-xs font-medium text-foreground leading-tight">
                                                    {activity.message}
                                                </p>
                                                {activity.projectName && (
                                                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                                        {activity.projectName}
                                                    </p>
                                                )}
                                                <p className="text-xs text-muted-foreground/70 mt-0.5">
                                                    {formatRelativeTime(
                                                        activity.timestamp,
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>

            {/* Usage Overview */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-base font-semibold">
                        Usage Overview
                    </CardTitle>
                </CardHeader>
                <CardContent>
                    <p className="text-sm text-muted-foreground py-4 text-center">
                        Usage metrics will appear once your projects receive
                        traffic.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
