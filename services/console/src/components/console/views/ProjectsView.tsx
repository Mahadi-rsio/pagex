"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { navigateToProjectOverview } from "@/lib/navigate";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
    Plus,
    FolderKanban,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Clock,
    GitBranch,
    ExternalLink,
    Globe,
} from "lucide-react";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        {...props}
    >
        <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22" />
    </svg>
);

const statusConfig = {
    active: {
        label: "Active",
        variant: "default" as const,
        icon: CheckCircle2,
        color: "text-foreground",
    },
    building: {
        label: "Building",
        variant: "secondary" as const,
        icon: Loader2,
        color: "text-muted-foreground",
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

const providerIcons = {
    github: GithubIcon,
    gitlab: Globe,
    bitbucket: GitBranch,
};

function EmptyProjects({ onCreateClick }: { onCreateClick: () => void }) {
    return (
        <div className="flex flex-1 items-center justify-center">
            <div className="relative flex flex-col items-center text-center py-24 px-6">
                <div
                    className="absolute inset-0 opacity-[0.04] dark:opacity-[0.06]"
                    style={{
                        backgroundImage: `
              linear-gradient(to right, currentColor 1px, transparent 1px),
              linear-gradient(to bottom, currentColor 1px, transparent 1px)
            `,
                        backgroundSize: "40px 40px",
                    }}
                />
                <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />

                <div className="relative z-10">
                    <div className="size-20 rounded-2xl bg-muted border border-border flex items-center justify-center mx-auto mb-6">
                        <FolderKanban className="size-10 text-foreground" />
                    </div>
                    <h2 className="text-xl font-bold text-foreground mb-2">
                        No projects yet
                    </h2>
                    <p className="text-sm text-muted-foreground max-w-sm mb-6">
                        Create your first project to deploy your applications
                        and start building with Console.
                    </p>
                    <Button onClick={onCreateClick} className="gap-2">
                        <Plus className="size-4" />
                        Create a Project
                    </Button>
                </div>
            </div>
        </div>
    );
}

export function ProjectsView() {
    const { projects, fetchProjects, isLoading, error } = useAppStore();
    const router = useRouter();

    // Fetch projects on mount
    useEffect(() => {
        fetchProjects();
    }, [fetchProjects]);

    if (projects.length === 0) {
        return (
            <div className="flex flex-col h-full">
                <div className="flex items-center justify-between px-6 py-5 border-b border-border">
                    <div>
                        <h1 className="text-xl font-bold text-foreground">
                            Projects
                        </h1>
                        <p className="text-xs text-muted-foreground mt-0.5">
                            Manage and deploy your applications
                        </p>
                    </div>
                    <Button
                        onClick={() => router.push("/projects/new")}
                        className="gap-2"
                    >
                        <Plus className="size-4" />
                        Add Project
                    </Button>
                </div>
                <EmptyProjects
                    onCreateClick={() => router.push("/projects/new")}
                />
            </div>
        );
    }

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between">
                <div>
                    <h1 className="text-xl font-bold text-foreground">
                        Projects
                    </h1>
                    <p className="text-sm text-muted-foreground mt-0.5">
                        {projects.length} project
                        {projects.length !== 1 ? "s" : ""}
                    </p>
                </div>
                <Button
                    onClick={() => router.push("/projects/new")}
                    className="gap-2"
                >
                    <Plus className="size-4" />
                    Add Project
                </Button>
            </div>

            {/* Projects Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {projects.map((project) => {
                    const status = statusConfig[project.status];
                    const StatusIcon = status.icon;
                    const ProviderIcon = project.provider
                        ? providerIcons[project.provider]
                        : FolderKanban;

                    return (
                        <button
                            key={project.id}
                            onClick={() =>
                                navigateToProjectOverview(project.id)
                            }
                            className="group text-left rounded-lg border border-border bg-card hover:border-primary/30 hover:shadow-lg transition-all duration-200 overflow-hidden cursor-pointer"
                        >
                            <div className="h-1.5 bg-foreground opacity-0 group-hover:opacity-100 transition-opacity" />

                            <div className="p-5">
                                <div className="flex items-start justify-between mb-4">
                                    <div className="flex items-center gap-3">
                                        <div className="size-10 rounded-xl bg-muted border border-border flex items-center justify-center">
                                            <FolderKanban className="size-5 text-foreground" />
                                        </div>
                                        <div className="min-w-0">
                                            <h3 className="font-semibold text-foreground text-sm leading-tight truncate max-w-[140px]">
                                                {project.name}
                                            </h3>
                                            {project.provider && (
                                                <div className="flex items-center gap-1 mt-0.5">
                                                    <ProviderIcon className="size-3 text-muted-foreground" />
                                                    <span className="text-xs text-muted-foreground truncate max-w-[120px]">
                                                        {project.repo}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1.5">
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
                                </div>

                                {project.description && (
                                    <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                                        {project.description}
                                    </p>
                                )}

                                {project.domain && (
                                    <div className="flex items-center gap-1.5 mb-4 py-2 px-3 rounded-lg bg-muted/50 border border-border/50">
                                        <ExternalLink className="size-3.5 text-muted-foreground shrink-0" />
                                        <span className="text-xs text-foreground font-medium truncate">
                                            {project.domain}
                                        </span>
                                    </div>
                                )}

                                <p className="text-xs text-muted-foreground">
                                    Updated{" "}
                                    {formatRelativeTime(project.updatedAt)}
                                </p>
                            </div>
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
