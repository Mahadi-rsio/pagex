"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    apiClient,
    type ApiBuild,
    type ApiDeployment,
} from "@/lib/api-client";
import { toast } from "sonner";
import {
    ExternalLink,
    GitBranch,
    CheckCircle2,
    Clock,
    Globe,
    GitCommitHorizontal,
    Zap,
} from "lucide-react";

import { LiveUsageSummary } from "./LiveUsageSummary";
import {
    fetchLatestGithubCommit,
    statusConfig,
    type LatestCommitInfo,
} from "./utils";

export function OverviewTab({ project }: { project: Project }) {
    const status =
        statusConfig[project.status as keyof typeof statusConfig] ||
        statusConfig.inactive;
    const StatusIcon = status.icon;
    const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(true);
    const [latestBuild, setLatestBuild] = useState<ApiBuild | null>(null);
    const [latestCommit, setLatestCommit] = useState<LatestCommitInfo | null>(
        null,
    );
    const [commitLoading, setCommitLoading] = useState(false);
    const [isRedeploying, setIsRedeploying] = useState(false);

    const loadDeployments = useCallback(async () => {
        try {
            const list = await apiClient.getDeployments(project.id);
            setDeployments(list.slice(0, 5));
        } catch {
            // Non-critical; keep previous state.
        } finally {
            setDeploymentsLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadDeployments();
    }, [loadDeployments]);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const list = await apiClient.getBuilds(project.id);
                if (cancelled) return;
                const build = list[0] ?? null;
                setLatestBuild(build);
                const repo = build?.repo_url || project.repo || null;
                if (!repo) {
                    setLatestCommit(null);
                    return;
                }
                setCommitLoading(true);
                const commit = await fetchLatestGithubCommit(repo);
                if (!cancelled) setLatestCommit(commit);
            } catch {
                if (!cancelled) setLatestBuild(null);
            } finally {
                if (!cancelled) setCommitLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [project.id, project.repo]);

    const handleRedeploy = async () => {
        if (!latestBuild || isRedeploying) return;
        setIsRedeploying(true);
        try {
            await apiClient.triggerBuild({
                pageId: project.id,
                repoUrl: latestBuild.repo_url,
                gitProvider: latestBuild.git_provider,
                framework: latestBuild.framework,
                ...(latestBuild.build_command
                    ? { buildCommand: latestBuild.build_command }
                    : {}),
                ...(latestBuild.output_dir
                    ? { outputDir: latestBuild.output_dir }
                    : {}),
            });
            toast.success(
                latestCommit
                    ? `Redeploy queued from ${latestCommit.shortSha}`
                    : "Redeploy queued from latest commit",
            );
        } catch (err) {
            toast.error(
                err instanceof Error ? err.message : "Failed to redeploy",
            );
        } finally {
            setIsRedeploying(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* Status Card */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-medium text-muted-foreground">
                                Deployment Status
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                                <StatusIcon
                                    className={`size-4 ${status.color} ${project.status === "building" ? "animate-spin" : ""}`}
                                />
                                <span className="text-lg font-semibold text-foreground">
                                    {status.label}
                                </span>
                            </div>
                        </div>
                        {project.domain && (
                            <a
                                href={`https://${project.domain}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                            >
                                <ExternalLink className="size-3.5" />
                                {project.domain}
                            </a>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Latest commit + redeploy */}
            <Card>
                <CardContent className="p-4">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2">
                                <GitCommitHorizontal className="size-4 text-muted-foreground" />
                                <p className="text-sm font-medium text-foreground">
                                    Latest commit
                                </p>
                            </div>
                            {commitLoading ? (
                                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                    <Spinner size="inline" />
                                    Loading…
                                </div>
                            ) : latestCommit ? (
                                <>
                                    <p className="text-sm text-foreground truncate">
                                        <a
                                            href={latestCommit.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="font-mono text-xs text-primary hover:underline mr-2"
                                        >
                                            {latestCommit.shortSha}
                                        </a>
                                        {latestCommit.message}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {latestCommit.author}
                                        {latestCommit.date
                                            ? ` · ${formatRelativeTime(latestCommit.date)}`
                                            : ""}
                                    </p>
                                </>
                            ) : (
                                <p className="text-xs text-muted-foreground">
                                    {latestBuild
                                        ? "Could not load the latest commit for this repository."
                                        : "Trigger a cloud build to enable redeploy from git."}
                                </p>
                            )}
                        </div>
                        <Button
                            size="sm"
                            className="gap-2 shrink-0"
                            onClick={handleRedeploy}
                            disabled={!latestBuild || isRedeploying}
                        >
                            {isRedeploying ? (
                                <Spinner size="inline" />
                            ) : (
                                <Zap className="size-3.5" />
                            )}
                            Redeploy
                        </Button>
                    </div>
                </CardContent>
            </Card>

            {/* Live Usage Summary */}
            <LiveUsageSummary project={project} />

            {/* Info Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {[
                    {
                        label: "Repository",
                        value: project.repo || "No repo",
                        icon: GitBranch,
                    },
                    {
                        label: "Provider",
                        value: project.provider || "Manual",
                        icon: Globe,
                    },
                    {
                        label: "Created",
                        value: formatRelativeTime(project.createdAt),
                        icon: Clock,
                    },
                    {
                        label: "Last Updated",
                        value: formatRelativeTime(project.updatedAt),
                        icon: Clock,
                    },
                    {
                        label: "Status",
                        value: status.label,
                        icon: CheckCircle2,
                    },
                    {
                        label: "Domain",
                        value: project.domain || "Not set",
                        icon: ExternalLink,
                    },
                ].map(({ label, value, icon: Icon }) => (
                    <Card key={label}>
                        <CardContent className="p-3">
                            <div className="flex items-center gap-2 mb-1.5">
                                <Icon className="size-3.5 text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    {label}
                                </p>
                            </div>
                            <p className="text-sm font-medium text-foreground truncate">
                                {value}
                            </p>
                        </CardContent>
                    </Card>
                ))}
            </div>

            {/* Recent Deploys */}
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">
                        Recent Deployments
                    </CardTitle>
                </CardHeader>
                <CardContent className="pt-0">
                    {deploymentsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner size="inline" />
                        </div>
                    ) : deployments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deployments yet. Trigger a cloud build to get
                            started.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {deployments.map((deploy) => (
                                <div
                                    key={deploy.id}
                                    className="flex items-center gap-3 p-2 rounded-none hover:bg-accent/50 transition-colors"
                                >
                                    <div
                                        className={`size-2 rounded-full shrink-0 ${deploy.is_active ? "bg-foreground" : "bg-muted-foreground/40"}`}
                                    />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs font-medium text-foreground truncate">
                                            {deploy.source === "build"
                                                ? `Cloud build · v${deploy.version}`
                                                : `Upload · v${deploy.version}`}
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            {deploy.file_count} files
                                            {deploy.is_active
                                                ? " · Active"
                                                : ""}
                                        </p>
                                    </div>
                                    <span className="text-xs text-muted-foreground shrink-0">
                                        {formatRelativeTime(deploy.created_at)}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

