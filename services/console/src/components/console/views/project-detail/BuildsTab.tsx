"use client";

import {
    AlertCircle,
    CheckCircle2,
    ChevronDown,
    ChevronUp,
    Clock,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { type ApiBuild, apiClient } from "@/lib/api-client";
import { formatRelativeTime } from "@/lib/utils";
import type { Project } from "@/store/useAppStore";

import { BuildTerminal } from "../../builds/BuildTerminal";
import { LatestCommitCard } from "./LatestCommitCard";
import { TriggerBuildCard } from "./TriggerBuildCard";
import {
    buildStatusConfig,
    fetchLatestGithubCommit,
    type LatestCommitInfo,
} from "./utils";

// ─── Main BuildsTab ───────────────────────────────────────────────────────────

export function BuildsTab({ project }: { project: Project }) {
    const [builds, setBuilds] = useState<ApiBuild[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);

    const [latestCommit, setLatestCommit] = useState<LatestCommitInfo | null>(
        null,
    );
    const [commitLoading, setCommitLoading] = useState(false);

    const loadBuilds = useCallback(async () => {
        try {
            const list = await apiClient.getBuilds(project.id);
            setBuilds(list);
            return list;
        } catch (loadError) {
            toast.error(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load builds",
            );
            return [];
        } finally {
            setLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadBuilds();
    }, [loadBuilds]);

    const commitRepoUrl = builds[0]?.repo_url || project.repo || null;

    useEffect(() => {
        if (!commitRepoUrl) {
            setLatestCommit(null);
            setCommitLoading(false);
            return;
        }
        let cancelled = false;
        setCommitLoading(true);
        fetchLatestGithubCommit(commitRepoUrl).then((commit) => {
            if (!cancelled) {
                setLatestCommit(commit);
                setCommitLoading(false);
            }
        });
        return () => {
            cancelled = true;
        };
    }, [commitRepoUrl]);

    const selectedBuild = builds.find((b) => b.id === selectedBuildId) ?? null;

    const toggleLogs = (buildId: string) => {
        setSelectedBuildId((prev) => (prev === buildId ? null : buildId));
    };

    const handleBuildCreated = async () => {
        const list = await loadBuilds();
        const newest = list[0];
        if (newest) setSelectedBuildId(newest.id);
    };

    const latestBuild = builds[0] ?? null;

    return (
        <div className="space-y-4">
            <LatestCommitCard
                commit={latestCommit}
                repoUrl={commitRepoUrl}
                loading={commitLoading}
            />

            <TriggerBuildCard
                project={project}
                defaultRepoUrl={latestBuild?.repo_url}
                defaultBranch={latestBuild?.branch}
                defaultFramework={latestBuild?.framework}
                onBuildCreated={handleBuildCreated}
            />

            <Card>
                <CardHeader>
                    <div>
                        <CardTitle className="text-sm">Cloud Builds</CardTitle>
                        <CardDescription className="text-xs">
                            Build history for your git repository. Click a build
                            to view logs.
                        </CardDescription>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner size="inline" />
                        </div>
                    ) : builds.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No builds yet. Trigger your first cloud build above.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {builds.map((build) => {
                                const config =
                                    buildStatusConfig[build.status] ??
                                    buildStatusConfig.queued;
                                const isSelected = selectedBuildId === build.id;
                                return (
                                    <div key={build.id} className="space-y-0">
                                        <button
                                            type="button"
                                            className="w-full text-left rounded-none border border-border p-3 hover:bg-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                            onClick={() => toggleLogs(build.id)}
                                            aria-expanded={isSelected}
                                        >
                                            <div className="flex items-center gap-3">
                                                <div className="flex size-8 shrink-0 items-center justify-center rounded-none bg-muted">
                                                    {build.status ===
                                                    "active" ? (
                                                        <Spinner size="inline" />
                                                    ) : build.status ===
                                                      "completed" ? (
                                                        <CheckCircle2 className="size-4 text-emerald-500" />
                                                    ) : build.status ===
                                                      "failed" ? (
                                                        <AlertCircle className="size-4 text-destructive" />
                                                    ) : (
                                                        <Clock className="size-4 text-muted-foreground" />
                                                    )}
                                                </div>
                                                <div className="min-w-0 flex-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="truncate text-sm font-medium text-foreground">
                                                            {build.framework}
                                                        </span>
                                                        <Badge
                                                            variant={
                                                                config.variant
                                                            }
                                                            className="text-xs"
                                                        >
                                                            {config.label}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                        {build.repo_url} ·{" "}
                                                        {build.build_command ??
                                                            "pnpm build"}
                                                    </p>
                                                    {latestCommit &&
                                                        build.repo_url ===
                                                            commitRepoUrl && (
                                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                                <span className="font-mono">
                                                                    {
                                                                        latestCommit.shortSha
                                                                    }
                                                                </span>
                                                                {" · "}
                                                                {
                                                                    latestCommit.message
                                                                }
                                                            </p>
                                                        )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatRelativeTime(
                                                            build.created_at,
                                                        )}
                                                    </span>
                                                    {isSelected ? (
                                                        <ChevronUp className="size-3.5 text-muted-foreground" />
                                                    ) : (
                                                        <ChevronDown className="size-3.5 text-muted-foreground" />
                                                    )}
                                                </div>
                                            </div>
                                        </button>
                                        {isSelected && selectedBuild && (
                                            <BuildTerminal
                                                buildId={selectedBuild.id}
                                                title={`Build logs · ${selectedBuild.framework}`}
                                                subtitle={`${selectedBuild.repo_url}${selectedBuild.build_command ? ` · ${selectedBuild.build_command}` : ""}`}
                                                onClose={() =>
                                                    setSelectedBuildId(null)
                                                }
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
