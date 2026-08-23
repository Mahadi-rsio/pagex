"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    apiClient,
    type ApiBuild,
} from "@/lib/api-client";
import { toast } from "sonner";
import {
    CheckCircle2,
    AlertCircle,
    Clock,
    ChevronDown,
    ChevronUp,
    Terminal,
} from "lucide-react";

import { LatestCommitCard } from "./LatestCommitCard";
import {
    buildStatusConfig,
    fetchLatestGithubCommit,
    type LatestCommitInfo,
} from "./utils";

// ─── Build Log Panel ─────────────────────────────────────────────────────────

function BuildLogPanel({ build, onClose }: { build: ApiBuild; onClose: () => void }) {
    const [lines, setLines] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setLines([]);
        setProgress(0);
        setDone(false);
        setError("");

        const controller = new AbortController();

        apiClient
            .streamBuildLogs(
                build.id,
                {
                    onLog: (message) => setLines((prev) => [...prev, message]),
                    onProgress: (value) => setProgress(value),
                    onDone: (event) => {
                        setDone(true);
                        if (event.error) {
                            setError(event.error);
                        }
                    },
                    onError: (event) => {
                        setDone(true);
                        setError(event.message);
                        setLines((prev) => [...prev, `[error] ${event.message}`]);
                    },
                },
                controller.signal,
            )
            .catch(() => {
                setDone(true);
                setError("Failed to connect to the build log stream");
            });

        return () => controller.abort();
    }, [build.id]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    const statusLabel = done
        ? error
            ? "Failed"
            : "Complete"
        : progress > 0
          ? `${Math.round(progress)}%`
          : "Streaming…";

    return (
        <div className="overflow-hidden rounded-none border border-border bg-[#0a0a0a] font-mono text-xs leading-relaxed text-zinc-300">
            {/* Header */}
            <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-4 py-2.5">
                <div className="flex items-center gap-2">
                    <Terminal className="size-3.5 text-zinc-400" />
                    <span className="font-sans text-xs font-medium text-zinc-200">
                        Build logs
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <Badge
                        variant="outline"
                        className="border-white/10 bg-white/[0.04] font-sans text-xs text-zinc-300"
                    >
                        {statusLabel}
                    </Badge>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-6 text-zinc-500 hover:text-zinc-200"
                        onClick={onClose}
                        aria-label="Close logs"
                    >
                        <ChevronUp className="size-3.5" />
                    </Button>
                </div>
            </div>
            {/* Progress bar */}
            {progress > 0 && !done && (
                <div className="h-0.5 bg-white/[0.06]">
                    <div
                        className="h-full bg-zinc-100 transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
            {/* Log content */}
            <div className="h-72 space-y-1 overflow-y-auto p-4">
                {lines.length === 0 && !done ? (
                    <div className="flex items-center gap-2 text-zinc-600">
                        <Spinner size="inline" />
                        <span>Waiting for build logs…</span>
                    </div>
                ) : (
                    lines.map((line, i) => (
                        <p
                            key={`${i}-${line}`}
                            className={
                                line.startsWith("✓")
                                    ? "text-zinc-100"
                                    : line.startsWith(">")
                                      ? "text-zinc-300"
                                      : line.startsWith("[error]")
                                        ? "text-red-400"
                                        : line.startsWith("[Summary]") || line.startsWith("[Stats]")
                                          ? "text-emerald-400"
                                          : "text-zinc-500"
                            }
                        >
                            {line}
                        </p>
                    ))
                )}
                {!done && lines.length > 0 && (
                    <span className="inline-block h-3 w-1.5 animate-pulse bg-zinc-100" />
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

// ─── Main BuildsTab ───────────────────────────────────────────────────────────

export function BuildsTab({ project }: { project: Project }) {
    const [builds, setBuilds] = useState<ApiBuild[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedBuildId, setSelectedBuildId] = useState<string | null>(null);

    const [latestCommit, setLatestCommit] = useState<LatestCommitInfo | null>(null);
    const [commitLoading, setCommitLoading] = useState(false);

    const loadBuilds = useCallback(async () => {
        try {
            const list = await apiClient.getBuilds(project.id);
            setBuilds(list);
        } catch (loadError) {
            toast.error(
                loadError instanceof Error
                    ? loadError.message
                    : "Failed to load builds",
            );
        } finally {
            setLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadBuilds();
    }, [loadBuilds]);

    const commitRepoUrl =
        builds[0]?.repo_url || project.repo || null;

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

    return (
        <div className="space-y-4">
            <LatestCommitCard
                commit={latestCommit}
                repoUrl={commitRepoUrl}
                loading={commitLoading}
            />

            <Card>
                <CardHeader>
                    <div>
                        <CardTitle className="text-sm">Cloud Builds</CardTitle>
                        <CardDescription className="text-xs">
                            Build history for your git repository. Click a build to view logs.
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
                            No builds yet. Trigger a cloud build from the Overview tab.
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
                                                    {build.status === "active" ? (
                                                        <Spinner size="inline" />
                                                    ) : build.status === "completed" ? (
                                                        <CheckCircle2 className="size-4 text-emerald-500" />
                                                    ) : build.status === "failed" ? (
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
                                                            variant={config.variant}
                                                            className="text-xs"
                                                        >
                                                            {config.label}
                                                        </Badge>
                                                    </div>
                                                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                        {build.repo_url} ·{" "}
                                                        {build.build_command ?? "pnpm build"}
                                                    </p>
                                                    {latestCommit &&
                                                        build.repo_url === commitRepoUrl && (
                                                            <p className="mt-0.5 truncate text-xs text-muted-foreground">
                                                                <span className="font-mono">
                                                                    {latestCommit.shortSha}
                                                                </span>
                                                                {" · "}
                                                                {latestCommit.message}
                                                            </p>
                                                        )}
                                                </div>
                                                <div className="flex items-center gap-2 shrink-0">
                                                    <span className="text-xs text-muted-foreground">
                                                        {formatRelativeTime(build.created_at)}
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
                                            <BuildLogPanel
                                                build={selectedBuild}
                                                onClose={() => setSelectedBuildId(null)}
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
