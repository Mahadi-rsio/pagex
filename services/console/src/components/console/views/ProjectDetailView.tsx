"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageSpinner from "@/components/pageloader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    ArrowLeft,
    ExternalLink,
    AlertCircle,
} from "lucide-react";

import { statusConfig } from "./project-detail/utils";
import { OverviewTab } from "./project-detail/OverviewTab";
import { DomainsTab } from "./project-detail/DomainsTab";
import { DeployTab } from "./project-detail/DeployTab";
import { BuildsTab } from "./project-detail/BuildsTab";
import { FilesTab } from "./project-detail/FilesTab";
import { EnvTab } from "./project-detail/EnvTab";
import { AnalyticsTab } from "./project-detail/AnalyticsTab";
import { PerformanceTab } from "./project-detail/PerformanceTab";
import { UsageTab } from "./project-detail/UsageTab";
import { SettingsTab } from "./project-detail/SettingsTab";

export function ProjectDetailView({ projectId }: { projectId: string }) {
    const router = useRouter();
    const project = useAppStore((s) =>
        s.projects.find((p) => p.id === projectId),
    );
    const isLoading = useAppStore((s) => s.isLoading);
    const fetchProjects = useAppStore((s) => s.fetchProjects);
    const fetchedRef = useRef(false);

    useEffect(() => {
        if (!project && !fetchedRef.current) {
            fetchedRef.current = true;
            fetchProjects();
        }
    }, [project, fetchProjects]);

    if (!project) {
        if (isLoading || !fetchedRef.current) {
            return <PageSpinner label="Loading project" />;
        }
        return (
            <div className="flex flex-col items-center justify-center h-full p-6 text-center">
                <AlertCircle className="size-12 text-muted-foreground/40 mb-4" />
                <h2 className="text-lg font-semibold text-foreground mb-2">
                    Project not found
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                    This project doesn't exist or you don't have access to it.
                </p>
                <Button onClick={() => router.push("/projects")}>
                    <ArrowLeft className="size-4 mr-2" />
                    Back to Projects
                </Button>
            </div>
        );
    }

    const status = statusConfig[project.status];
    const StatusIcon = status.icon;

    return (
        <div className="p-6 space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => router.push("/projects")}
                    className="size-9"
                >
                    <ArrowLeft className="size-4" />
                </Button>
                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-3">
                        <h1 className="text-xl font-bold text-foreground truncate">
                            {project.name}
                        </h1>
                        <div className="flex items-center gap-1.5">
                            <StatusIcon
                                className={`size-4 ${status.color} ${project.status === "building" ? "animate-spin" : ""}`}
                            />
                            <Badge
                                variant={status.badgeVariant}
                                className="text-xs"
                            >
                                {status.label}
                            </Badge>
                        </div>
                    </div>
                    {project.description && (
                        <p className="text-sm text-muted-foreground mt-0.5 truncate">
                            {project.description}
                        </p>
                    )}
                </div>
                {project.domain && (
                    <a
                        href={`https://${project.domain}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="hidden sm:flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors border border-border rounded-none px-3 py-2"
                    >
                        <ExternalLink className="size-3.5" />
                        {project.domain}
                    </a>
                )}
            </div>

            {/* Tabs */}
            <Tabs defaultValue="overview" className="space-y-4">
                <div className="-mx-6 px-6 overflow-x-auto scrollbar-none overscroll-x-contain touch-pan-x">
                    <TabsList className="h-9 w-max min-w-full sm:min-w-0 p-1 bg-muted/50 border border-border justify-start">
                        {[
                            { value: "overview", label: "Overview" },
                            { value: "domains", label: "Domains" },
                            { value: "deploys", label: "Deploys" },
                            { value: "builds", label: "Builds" },
                            { value: "files", label: "Files" },
                            { value: "environment", label: "Environment" },
                            { value: "analytics", label: "Analytics" },
                            { value: "performance", label: "Performance" },
                            { value: "usage", label: "Usage" },
                            { value: "settings", label: "Settings" },
                        ].map(({ value, label }) => (
                            <TabsTrigger
                                key={value}
                                value={value}
                                className="text-xs h-7 px-3 shrink-0 snap-start"
                            >
                                {label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>

                <TabsContent value="overview">
                    <OverviewTab project={project} />
                </TabsContent>
                <TabsContent value="domains">
                    <DomainsTab project={project} />
                </TabsContent>
                <TabsContent value="deploys">
                    <DeployTab project={project} />
                </TabsContent>
                <TabsContent value="builds">
                    <BuildsTab project={project} />
                </TabsContent>
                <TabsContent value="files">
                    <FilesTab project={project} />
                </TabsContent>
                <TabsContent value="environment">
                    <EnvTab />
                </TabsContent>
                <TabsContent value="analytics">
                    <AnalyticsTab project={project} />
                </TabsContent>
                <TabsContent value="performance">
                    <PerformanceTab />
                </TabsContent>
                <TabsContent value="usage">
                    <UsageTab project={project} />
                </TabsContent>
                <TabsContent value="settings">
                    <SettingsTab project={project} />
                </TabsContent>
            </Tabs>
        </div>
    );
}
