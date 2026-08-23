"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import PageSpinner from "@/components/pageloader";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
    Sheet,
    SheetContent,
    SheetDescription,
    SheetFooter,
    SheetHeader,
    SheetTitle,
} from "@/components/ui/sheet";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
    AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    apiClient,
    type ApiBuild,
    type ApiDeployment,
    type ApiUsage,
} from "@/lib/api-client";
import { Tree, type TreeViewElement } from "@/components/ui/file-tree";
import { toast } from "sonner";
import {
    ArrowLeft,
    ExternalLink,
    GitBranch,
    CheckCircle2,
    AlertCircle,
    Loader2,
    Clock,
    Globe,
    HardDrive,
    Plus,
    Trash2,
    Copy,
    Eye,
    EyeOff,
    Activity,
    RefreshCw,
    Play,
    X,
    RotateCcw,
    FileText,
    MoreHorizontal,
    GitCommitHorizontal,
    Gauge,
    Zap,
} from "lucide-react";

const CNAME_TARGET = "cname.console.app";

function pathsToTreeElements(paths: string[]): TreeViewElement[] {
    type MutableNode = TreeViewElement & { children?: MutableNode[] };
    const root: MutableNode[] = [];
    const folders = new Map<string, MutableNode>();

    for (const rawPath of paths) {
        const normalized = rawPath.replace(/^\/+/, "");
        const parts = normalized.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let siblings = root;
        let currentPath = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const isFile = i === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (isFile) {
                siblings.push({
                    id: currentPath,
                    name: part,
                    type: "file",
                    isSelectable: true,
                });
                continue;
            }

            let folder = folders.get(currentPath);
            if (!folder) {
                folder = {
                    id: currentPath,
                    name: part,
                    type: "folder",
                    isSelectable: true,
                    children: [],
                };
                folders.set(currentPath, folder);
                siblings.push(folder);
            }
            siblings = folder.children!;
        }
    }

    return root;
}

function topLevelExpandedIds(elements: TreeViewElement[]): string[] {
    return elements
        .filter((el) => el.type === "folder" || Array.isArray(el.children))
        .map((el) => el.id);
}

function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(3)} GB`;
}

/** Single bar: flushed (DB) + live (Redis) as adjacent segments. */
function CombinedUsageBar({
    flushed,
    live,
    limit,
    formatValue,
    className,
}: {
    flushed: number;
    live: number;
    limit: number;
    formatValue: (n: number) => string;
    className?: string;
}) {
    const safeLimit = limit > 0 ? limit : 1;
    const flushedPct = Math.min(100, Math.max(0, (flushed / safeLimit) * 100));
    const livePct = Math.min(
        100 - flushedPct,
        Math.max(0, (live / safeLimit) * 100),
    );

    return (
        <div className="space-y-1.5">
            <div
                className={`relative h-2 w-full overflow-hidden rounded-none border border-border/60 bg-muted/70 ${className ?? ""}`}
            >
                <div className="absolute inset-y-0 left-0 flex h-full w-full">
                    <div
                        className="h-full bg-primary transition-all"
                        style={{ width: `${flushedPct}%` }}
                        title={`Flushed: ${formatValue(flushed)}`}
                    />
                    <div
                        className="h-full bg-emerald-500/80 transition-all"
                        style={{ width: `${livePct}%` }}
                        title={`Live: ${formatValue(live)}`}
                    />
                </div>
            </div>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[10px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 bg-primary" />
                    Flushed {formatValue(flushed)}
                </span>
                <span className="inline-flex items-center gap-1.5">
                    <span className="size-1.5 shrink-0 bg-emerald-500/80" />
                    Live {formatValue(live)}
                </span>
            </div>
        </div>
    );
}

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
        icon: CheckCircle2,
        color: "text-foreground",
        badgeVariant: "default" as const,
    },
    building: {
        label: "Building",
        icon: Loader2,
        color: "text-muted-foreground",
        badgeVariant: "secondary" as const,
    },
    error: {
        label: "Error",
        icon: AlertCircle,
        color: "text-destructive",
        badgeVariant: "destructive" as const,
    },
    inactive: {
        label: "Inactive",
        icon: Clock,
        color: "text-muted-foreground",
        badgeVariant: "outline" as const,
    },
};

function LiveUsageSummary({ project }: { project: Project }) {
    const [usage, setUsage] = useState<ApiUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
    const [isLive, setIsLive] = useState(false);

    const loadUsage = useCallback(
        async (quiet = false) => {
            if (!project.domain) return;
            if (!quiet) setLoading(true);
            try {
                const data = await apiClient.getPageUsage(project.domain);
                setUsage(data);
                setLastUpdated(new Date());
                setIsLive(true);
                // Briefly flash the live indicator
                window.setTimeout(() => setIsLive(false), 1200);
            } catch {
                // Non-critical — silently ignore in overview
            } finally {
                if (!quiet) setLoading(false);
            }
        },
        [project.domain],
    );

    useEffect(() => {
        loadUsage();
        if (!project.domain) return;
        const id = window.setInterval(() => loadUsage(true), 10_000);
        return () => window.clearInterval(id);
    }, [loadUsage, project.domain]);

    if (!project.domain) return null;

    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2">
                        <Activity className="size-4 text-muted-foreground" />
                        <CardTitle className="text-sm">Live Usage</CardTitle>
                        {/* Pulsing live dot */}
                        <span
                            className={`inline-flex size-2 rounded-full transition-colors duration-500 ${
                                isLive
                                    ? "bg-emerald-500 animate-pulse"
                                    : "bg-emerald-500/40"
                            }`}
                        />
                    </div>
                    <div className="flex items-center gap-2">
                        {lastUpdated && (
                            <span className="text-xs text-muted-foreground hidden sm:inline">
                                {formatRelativeTime(lastUpdated.toISOString())}
                            </span>
                        )}
                        <Button
                            size="sm"
                            variant="ghost"
                            className="size-7 p-0"
                            onClick={() => loadUsage(false)}
                            disabled={loading}
                        >
                            <RefreshCw
                                className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                            />
                        </Button>
                    </div>
                </div>
            </CardHeader>
            <CardContent className="space-y-4 pt-0">
                {loading && !usage ? (
                    <div className="flex items-center justify-center py-6 gap-2 text-sm text-muted-foreground">
                        <Spinner size="inline" />
                        Loading usage…
                    </div>
                ) : !usage ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                        No usage data yet — usage appears once your site
                        receives traffic.
                    </p>
                ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        {/* Requests */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                    <Activity className="size-3 text-muted-foreground" />
                                    Requests
                                </span>
                                <span className="text-xs text-muted-foreground font-medium tabular-nums">
                                    {usage.requests.used.toLocaleString()} /{" "}
                                    {usage.requests.limit.toLocaleString()}
                                </span>
                            </div>
                            <CombinedUsageBar
                                flushed={usage.requests.flushed}
                                live={usage.requests.live}
                                limit={usage.requests.limit}
                                formatValue={(n) => n.toLocaleString()}
                                className="h-1.5"
                            />
                        </div>

                        {/* Bandwidth */}
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-medium text-foreground flex items-center gap-1.5">
                                    <HardDrive className="size-3 text-muted-foreground" />
                                    Bandwidth
                                </span>
                                <span className="text-xs text-muted-foreground font-medium tabular-nums">
                                    {formatBytes(usage.bandwidth.used_bytes)} /{" "}
                                    {usage.bandwidth.limit}
                                </span>
                            </div>
                            <CombinedUsageBar
                                flushed={usage.bandwidth.flushed_bytes}
                                live={usage.bandwidth.live_bytes}
                                limit={usage.bandwidth.limit_bytes}
                                formatValue={formatBytes}
                                className="h-1.5"
                            />
                        </div>
                    </div>
                )}

                {/* Sync status footer */}
                {usage && (
                    <div className="flex items-center gap-2 pt-1 border-t border-border/50">
                        <span
                            className={`inline-flex size-1.5 rounded-full ${
                                usage.sync.pending_flush
                                    ? "bg-amber-500"
                                    : "bg-emerald-500"
                            }`}
                        />
                        <span className="text-[10px] text-muted-foreground">
                            {usage.sync.pending_flush
                                ? "Pending Redis → DB flush"
                                : "Fully synced to DB"}
                            {" · "}
                            Flushes every{" "}
                            {Math.round(
                                (usage.sync.interval_seconds || 300) / 60,
                            )}{" "}
                            min
                        </span>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function OverviewTab({ project }: { project: Project }) {
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

function DomainsTab({ project }: { project: Project }) {
    type DomainEntry = {
        domain: string;
        type: "Automatic" | "Custom";
        verified: boolean;
    };

    const [loading, setLoading] = useState(true);
    const [domains, setDomains] = useState<DomainEntry[]>([]);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [step, setStep] = useState<"name" | "dns">("name");
    const [domainInput, setDomainInput] = useState("");
    const [pendingDomain, setPendingDomain] = useState("");
    const [error, setError] = useState("");
    const [copiedKey, setCopiedKey] = useState<string | null>(null);

    const loadDomain = useCallback(async () => {
        setLoading(true);
        try {
            const pages = await apiClient.getPages();
            const page = pages.find((p) => p.id === project.id);
            const activeDomain = page?.domain ?? project.domain ?? null;
            setDomains(
                activeDomain
                    ? [
                          {
                              domain: activeDomain,
                              type: "Automatic",
                              verified: true,
                          },
                      ]
                    : [],
            );
        } catch (err) {
            toast.error(
                err instanceof Error
                    ? err.message
                    : "Failed to load project domain",
            );
            setDomains(
                project.domain
                    ? [
                          {
                              domain: project.domain,
                              type: "Automatic",
                              verified: true,
                          },
                      ]
                    : [],
            );
        } finally {
            setLoading(false);
        }
    }, [project.domain, project.id]);

    useEffect(() => {
        loadDomain();
    }, [loadDomain]);

    const resetDrawer = () => {
        setStep("name");
        setDomainInput("");
        setPendingDomain("");
        setError("");
        setCopiedKey(null);
    };

    const handleDrawerOpenChange = (open: boolean) => {
        setDrawerOpen(open);
        if (!open) resetDrawer();
    };

    const normalizeDomain = (value: string) =>
        value
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, "")
            .replace(/^www\./, "");

    const handleContinue = () => {
        const domain = normalizeDomain(domainInput);

        if (!domain) {
            setError("Domain name is required");
            return;
        }
        if (
            !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/.test(
                domain,
            )
        ) {
            setError("Enter a valid domain (e.g. example.com)");
            return;
        }
        if (
            domains.some(
                (d) => d.domain === domain || d.domain === `www.${domain}`,
            )
        ) {
            setError("This domain is already added");
            return;
        }

        setPendingDomain(domain);
        setStep("dns");
        setError("");
    };

    const handleCopy = async (key: string, value: string) => {
        try {
            await navigator.clipboard.writeText(value);
            setCopiedKey(key);
            window.setTimeout(() => setCopiedKey(null), 1500);
        } catch {
            // ignore clipboard errors
        }
    };

    const handleDone = () => {
        toast.error("Custom domains are not available yet");
        handleDrawerOpenChange(false);
    };

    const dnsRecords = pendingDomain
        ? [
              { host: pendingDomain, type: "CNAME", value: CNAME_TARGET },
              {
                  host: `www.${pendingDomain}`,
                  type: "CNAME",
                  value: CNAME_TARGET,
              },
          ]
        : [];

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">Domains</CardTitle>
                            <CardDescription className="text-xs">
                                Active domain for this project
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={loadDomain}
                                disabled={loading}
                            >
                                <RefreshCw
                                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                                />
                                Refresh
                            </Button>
                            <Button
                                size="sm"
                                className="gap-2"
                                onClick={() => setDrawerOpen(true)}
                            >
                                <Plus className="size-3.5" />
                                Add Domain
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex items-center justify-center py-10">
                            <Spinner size="default" />
                        </div>
                    ) : domains.length === 0 ? (
                        <p className="text-sm text-muted-foreground py-6 text-center">
                            No domain assigned to this project yet.
                        </p>
                    ) : (
                        <div className="space-y-3">
                            {domains.map((d) => (
                                <div
                                    key={d.domain}
                                    className="flex items-center gap-3 rounded-none border border-border p-3"
                                >
                                    <Globe className="size-4 shrink-0 text-muted-foreground" />
                                    <div className="min-w-0 flex-1">
                                        <a
                                            href={`https://${d.domain}`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="flex items-center gap-1.5 truncate text-sm font-medium text-foreground hover:underline"
                                        >
                                            {d.domain}
                                            <ExternalLink className="size-3 shrink-0 text-muted-foreground" />
                                        </a>
                                        <p className="text-xs text-muted-foreground">
                                            {d.type}
                                        </p>
                                    </div>
                                    {d.verified ? (
                                        <Badge
                                            variant="secondary"
                                            className="text-xs"
                                        >
                                            <CheckCircle2 className="mr-1 size-3" />{" "}
                                            Verified
                                        </Badge>
                                    ) : (
                                        <Badge
                                            variant="outline"
                                            className="text-xs"
                                        >
                                            Pending DNS
                                        </Badge>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            <Sheet open={drawerOpen} onOpenChange={handleDrawerOpenChange}>
                <SheetContent
                    side="bottom"
                    className="mx-auto max-h-[85vh] max-w-lg gap-0 overflow-y-auto rounded-none p-0"
                >
                    <SheetHeader className="border-b border-border p-4">
                        <SheetTitle>
                            {step === "name" ? "Add Domain" : "Configure DNS"}
                        </SheetTitle>
                        <SheetDescription>
                            {step === "name"
                                ? "Enter the domain you want to connect to this project."
                                : "Point these DNS records to finish connecting your domain."}
                        </SheetDescription>
                    </SheetHeader>

                    {step === "name" ? (
                        <>
                            <div className="space-y-3 p-4">
                                <div className="space-y-1.5">
                                    <Label htmlFor="domain-name">
                                        Domain name
                                    </Label>
                                    <Input
                                        id="domain-name"
                                        placeholder="example.com"
                                        value={domainInput}
                                        onChange={(e) => {
                                            setDomainInput(e.target.value);
                                            setError("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                handleContinue();
                                        }}
                                        autoFocus
                                    />
                                    <p className="text-xs text-muted-foreground">
                                        We&apos;ll also configure www for this
                                        domain.
                                    </p>
                                </div>
                                {error && (
                                    <p className="text-xs text-destructive">
                                        {error}
                                    </p>
                                )}
                            </div>
                            <SheetFooter className="border-t border-border p-4 sm:flex-row">
                                <Button
                                    variant="ghost"
                                    onClick={() =>
                                        handleDrawerOpenChange(false)
                                    }
                                >
                                    Cancel
                                </Button>
                                <Button onClick={handleContinue}>
                                    Continue
                                </Button>
                            </SheetFooter>
                        </>
                    ) : (
                        <>
                            <div className="space-y-4 p-4">
                                <div className="rounded-none border border-border bg-muted/30 p-3">
                                    <div className="flex items-center gap-2">
                                        <Spinner size="inline" />
                                        <p className="text-sm font-medium text-foreground">
                                            Waiting for DNS
                                        </p>
                                    </div>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                        Add the CNAME records below at your DNS
                                        provider. Verification usually takes a
                                        few minutes.
                                    </p>
                                </div>

                                <div className="space-y-3">
                                    {dnsRecords.map((record) => (
                                        <div
                                            key={record.host}
                                            className="space-y-2 rounded-none border border-border p-3"
                                        >
                                            <div className="flex items-center justify-between gap-2">
                                                <p className="truncate text-sm font-medium text-foreground">
                                                    {record.host}
                                                </p>
                                                <Badge
                                                    variant="outline"
                                                    className="shrink-0 text-xs"
                                                >
                                                    {record.type}
                                                </Badge>
                                            </div>
                                            <div className="grid gap-2 sm:grid-cols-2">
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground">
                                                        Name / Host
                                                    </p>
                                                    <div className="flex items-center gap-1.5 rounded-none bg-muted/50 px-2.5 py-2">
                                                        <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                                            {record.host}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-6 shrink-0"
                                                            onClick={() =>
                                                                handleCopy(
                                                                    `${record.host}-host`,
                                                                    record.host,
                                                                )
                                                            }
                                                        >
                                                            {copiedKey ===
                                                            `${record.host}-host` ? (
                                                                <CheckCircle2 className="size-3 text-foreground" />
                                                            ) : (
                                                                <Copy className="size-3 text-muted-foreground" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                                <div className="space-y-1">
                                                    <p className="text-xs text-muted-foreground">
                                                        Value / Target
                                                    </p>
                                                    <div className="flex items-center gap-1.5 rounded-none bg-muted/50 px-2.5 py-2">
                                                        <code className="min-w-0 flex-1 truncate text-xs text-foreground">
                                                            {record.value}
                                                        </code>
                                                        <Button
                                                            variant="ghost"
                                                            size="icon"
                                                            className="size-6 shrink-0"
                                                            onClick={() =>
                                                                handleCopy(
                                                                    `${record.host}-value`,
                                                                    record.value,
                                                                )
                                                            }
                                                        >
                                                            {copiedKey ===
                                                            `${record.host}-value` ? (
                                                                <CheckCircle2 className="size-3 text-foreground" />
                                                            ) : (
                                                                <Copy className="size-3 text-muted-foreground" />
                                                            )}
                                                        </Button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <SheetFooter className="border-t border-border p-4 sm:flex-row">
                                <Button
                                    variant="ghost"
                                    onClick={() => setStep("name")}
                                >
                                    Back
                                </Button>
                                <Button onClick={handleDone}>Done</Button>
                            </SheetFooter>
                        </>
                    )}
                </SheetContent>
            </Sheet>
        </div>
    );
}

function EnvTab() {
    type EnvVar = {
        id: string;
        key: string;
        value: string;
        environment: "All" | "Production" | "Preview" | "Development";
    };

    const [envVars, setEnvVars] = useState<EnvVar[]>([]);
    const [showValues, setShowValues] = useState<Record<string, boolean>>({});
    const [isAdding, setIsAdding] = useState(false);
    const [newKey, setNewKey] = useState("");
    const [newValue, setNewValue] = useState("");
    const [newEnvironment, setNewEnvironment] =
        useState<EnvVar["environment"]>("All");
    const [error, setError] = useState("");

    const resetForm = () => {
        setNewKey("");
        setNewValue("");
        setNewEnvironment("All");
        setError("");
        setIsAdding(false);
    };

    const handleAdd = () => {
        const key = newKey.trim();
        const value = newValue.trim();

        if (!key) {
            setError("Key is required");
            return;
        }
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
            setError(
                "Key must be a valid identifier (letters, numbers, underscore)",
            );
            return;
        }
        if (
            envVars.some(
                (env) => env.key === key && env.environment === newEnvironment,
            )
        ) {
            setError(`"${key}" already exists for ${newEnvironment}`);
            return;
        }
        if (!value) {
            setError("Value is required");
            return;
        }

        setEnvVars((prev) => [
            {
                id: Math.random().toString(36).substring(2, 9),
                key,
                value,
                environment: newEnvironment,
            },
            ...prev,
        ]);
        resetForm();
    };

    const handleDelete = (id: string) => {
        setEnvVars((prev) => prev.filter((env) => env.id !== id));
    };

    const handleCopy = async (value: string) => {
        try {
            await navigator.clipboard.writeText(value);
        } catch {
            // ignore clipboard errors
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Environment Variables
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Manage environment variables for your
                                deployments
                            </CardDescription>
                        </div>
                        {!isAdding && (
                            <Button
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => setIsAdding(true)}
                            >
                                <Plus className="size-3.5" />
                                Add Variable
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {isAdding && (
                        <div className="space-y-3 border border-border p-3 bg-muted/20 rounded-none">
                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-key">Key</Label>
                                    <Input
                                        id="env-key"
                                        placeholder="API_KEY"
                                        value={newKey}
                                        onChange={(e) => {
                                            setNewKey(
                                                e.target.value.toUpperCase(),
                                            );
                                            setError("");
                                        }}
                                        className="font-mono"
                                        autoFocus
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-value">Value</Label>
                                    <Input
                                        id="env-value"
                                        placeholder="secret-value"
                                        value={newValue}
                                        onChange={(e) => {
                                            setNewValue(e.target.value);
                                            setError("");
                                        }}
                                        className="font-mono"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="env-environment">
                                        Environment
                                    </Label>
                                    <select
                                        id="env-environment"
                                        value={newEnvironment}
                                        onChange={(e) =>
                                            setNewEnvironment(
                                                e.target
                                                    .value as EnvVar["environment"],
                                            )
                                        }
                                        className="h-9 w-full rounded-none border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                    >
                                        <option value="All">All</option>
                                        <option value="Production">
                                            Production
                                        </option>
                                        <option value="Preview">Preview</option>
                                        <option value="Development">
                                            Development
                                        </option>
                                    </select>
                                </div>
                            </div>
                            {error && (
                                <p className="text-xs text-destructive">
                                    {error}
                                </p>
                            )}
                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={resetForm}
                                >
                                    Cancel
                                </Button>
                                <Button size="sm" onClick={handleAdd}>
                                    Save Variable
                                </Button>
                            </div>
                        </div>
                    )}

                    <div className="space-y-2">
                        {envVars.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-6 text-center">
                                No environment variables yet. Add one to get
                                started.
                            </p>
                        ) : (
                            envVars.map((env) => (
                                <div
                                    key={env.id}
                                    className="flex items-center gap-3 p-3 border border-border rounded-none"
                                >
                                    <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
                                        <p className="text-sm font-mono font-medium text-foreground truncate">
                                            {env.key}
                                        </p>
                                        <p className="text-sm font-mono text-muted-foreground truncate">
                                            {showValues[env.id]
                                                ? env.value
                                                : "••••••••••••"}
                                        </p>
                                    </div>
                                    <Badge
                                        variant="outline"
                                        className="text-xs shrink-0"
                                    >
                                        {env.environment}
                                    </Badge>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() =>
                                            setShowValues((prev) => ({
                                                ...prev,
                                                [env.id]: !prev[env.id],
                                            }))
                                        }
                                    >
                                        {showValues[env.id] ? (
                                            <EyeOff className="size-3.5" />
                                        ) : (
                                            <Eye className="size-3.5" />
                                        )}
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() => handleCopy(env.value)}
                                    >
                                        <Copy className="size-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="size-7 shrink-0"
                                        onClick={() => handleDelete(env.id)}
                                    >
                                        <Trash2 className="size-3.5 text-muted-foreground" />
                                    </Button>
                                </div>
                            ))
                        )}
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

function FilesTab({ project }: { project: Project }) {
    const [loading, setLoading] = useState(true);
    const [elements, setElements] = useState<TreeViewElement[]>([]);
    const [deploymentVersion, setDeploymentVersion] = useState<number | null>(
        null,
    );
    const [fileCount, setFileCount] = useState(0);
    const [totalSize, setTotalSize] = useState(0);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        try {
            const result = await apiClient.getDeploymentFiles(project.id);
            const visibleFiles = result.files.filter(
                (f) => !/\.(br|gz)$/i.test(f.path),
            );
            setElements(pathsToTreeElements(visibleFiles.map((f) => f.path)));
            setDeploymentVersion(result.deployment?.version ?? null);
            setFileCount(visibleFiles.length);
            setTotalSize(
                visibleFiles.reduce((sum, f) => sum + (f.size || 0), 0),
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load deployment files",
            );
            setElements([]);
            setDeploymentVersion(null);
            setFileCount(0);
            setTotalSize(0);
        } finally {
            setLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">Files</CardTitle>
                            <CardDescription className="text-xs">
                                {deploymentVersion != null
                                    ? `Deployment v${deploymentVersion} · ${fileCount} file${fileCount === 1 ? "" : "s"} · ${formatBytes(totalSize)}`
                                    : "Browse project files from latest deployment"}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={loadFiles}
                                disabled={loading}
                            >
                                <RefreshCw
                                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                                />
                                Refresh
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex h-80 items-center justify-center rounded-none border border-border bg-muted/20">
                            <Spinner size="default" />
                        </div>
                    ) : elements.length === 0 ? (
                        <div className="flex h-80 items-center justify-center rounded-none border border-border bg-muted/20">
                            <p className="text-sm text-muted-foreground">
                                No deployed files yet.
                            </p>
                        </div>
                    ) : (
                        <div className="h-80 rounded-none border border-border bg-muted/20 p-2">
                            <Tree
                                elements={elements}
                                initialExpandedItems={topLevelExpandedIds(
                                    elements,
                                )}
                                className="h-full"
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

function DeployTab({ project }: { project: Project }) {
    const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(true);
    const [rollingBack, setRollingBack] = useState<string | null>(null);

    const loadDeployments = useCallback(async () => {
        try {
            const list = await apiClient.getDeployments(project.id);
            setDeployments(list);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load deployments",
            );
        } finally {
            setDeploymentsLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadDeployments();
    }, [loadDeployments]);

    const handleRollback = async (deployment: ApiDeployment) => {
        if (rollingBack || deployment.is_active) return;
        if (
            !window.confirm(
                `Roll back to deployment v${deployment.version}? This will make it the live version.`,
            )
        ) {
            return;
        }
        setRollingBack(deployment.id);
        try {
            await apiClient.rollback(deployment.id);
            toast.success(`Rolled back to v${deployment.version}`);
            loadDeployments();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Rollback failed",
            );
        } finally {
            setRollingBack(null);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Deployment History
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Roll back to any previous deployment
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 shrink-0"
                            onClick={loadDeployments}
                        >
                            <RefreshCw className="size-3.5" />
                            Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {deploymentsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner size="inline" />
                        </div>
                    ) : deployments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deployments yet.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {deployments.map((deployment) => (
                                <div
                                    key={deployment.id}
                                    className="flex items-center gap-3 rounded-none border border-border p-3"
                                >
                                    <div
                                        className={`size-2 rounded-full shrink-0 ${deployment.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-foreground">
                                                v{deployment.version}
                                            </p>
                                            <Badge
                                                variant={
                                                    deployment.is_active
                                                        ? "default"
                                                        : "outline"
                                                }
                                                className="text-xs"
                                            >
                                                {deployment.is_active
                                                    ? "Live"
                                                    : deployment.source}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {deployment.file_count} files ·{" "}
                                            {deployment.filesDeployed ?? 0}{" "}
                                            deployed /{" "}
                                            {deployment.filesReused ?? 0} reused
                                            ·{" "}
                                            {formatRelativeTime(
                                                deployment.created_at,
                                            )}
                                        </p>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-8 shrink-0"
                                                disabled={
                                                    rollingBack ===
                                                    deployment.id
                                                }
                                                aria-label={`Actions for deployment v${deployment.version}`}
                                            >
                                                {rollingBack ===
                                                deployment.id ? (
                                                    <Spinner size="inline" />
                                                ) : (
                                                    <MoreHorizontal className="size-4" />
                                                )}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            className="w-40"
                                        >
                                            <DropdownMenuItem
                                                disabled={
                                                    deployment.is_active ||
                                                    rollingBack !== null
                                                }
                                                className="cursor-pointer gap-2"
                                                onSelect={() =>
                                                    handleRollback(deployment)
                                                }
                                            >
                                                <RotateCcw className="size-3.5" />
                                                Rollback
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

const buildStatusConfig: Record<
    ApiBuild["status"],
    {
        label: string;
        variant: "default" | "secondary" | "destructive" | "outline";
    }
> = {
    queued: { label: "Queued", variant: "secondary" },
    active: { label: "Building", variant: "secondary" },
    completed: { label: "Completed", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
};

function parseEnvVars(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
    const match = repoUrl
        .trim()
        .match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (!match) return null;
    return { owner: match[1]!, repo: match[2]! };
}

type LatestCommitInfo = {
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    date: string;
    url: string;
};

async function fetchLatestGithubCommit(
    repoUrl: string,
): Promise<LatestCommitInfo | null> {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) return null;
    try {
        const res = await fetch(
            `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=1`,
            { headers: { Accept: "application/vnd.github+json" } },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as Array<{
            sha: string;
            html_url: string;
            commit: {
                message: string;
                author?: { name?: string; date?: string };
            };
            author?: { login?: string };
        }>;
        const commit = data[0];
        if (!commit) return null;
        return {
            sha: commit.sha,
            shortSha: commit.sha.slice(0, 7),
            message: commit.commit.message.split("\n")[0] || "No message",
            author:
                commit.commit.author?.name ||
                commit.author?.login ||
                "unknown",
            date: commit.commit.author?.date || "",
            url: commit.html_url,
        };
    } catch {
        return null;
    }
}

function LatestCommitCard({
    commit,
    repoUrl,
    loading,
}: {
    commit: LatestCommitInfo | null;
    repoUrl: string | null;
    loading: boolean;
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <GitCommitHorizontal className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Latest commit</CardTitle>
                </div>
                <CardDescription className="text-xs">
                    {repoUrl
                        ? `From ${repoUrl.replace(/^https?:\/\//, "")}`
                        : "Connect a GitHub repository to show the latest commit"}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                        <Spinner size="inline" />
                        Loading commit…
                    </div>
                ) : !repoUrl ? (
                    <p className="text-sm text-muted-foreground">
                        No repository linked yet. Trigger a build to associate a
                        repo.
                    </p>
                ) : !commit ? (
                    <p className="text-sm text-muted-foreground">
                        Could not load the latest commit. The repo may be
                        private or unavailable.
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <a
                                href={commit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-primary hover:underline"
                            >
                                {commit.shortSha}
                            </a>
                            <span className="text-sm font-medium text-foreground">
                                {commit.message}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {commit.author}
                            {commit.date
                                ? ` · ${formatRelativeTime(commit.date)}`
                                : ""}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

function BuildsTab({ project }: { project: Project }) {
    const [builds, setBuilds] = useState<ApiBuild[]>([]);
    const [loading, setLoading] = useState(true);
    const [showTrigger, setShowTrigger] = useState(false);
    const [isTriggering, setIsTriggering] = useState(false);
    const [error, setError] = useState("");

    const [repoUrl, setRepoUrl] = useState("");
    const [gitToken, setGitToken] = useState("");
    const [framework, setFramework] = useState("vite");
    const [buildCommand, setBuildCommand] = useState("pnpm build");
    const [outputDir, setOutputDir] = useState("dist");
    const [envVarsText, setEnvVarsText] = useState("");

    const [latestCommit, setLatestCommit] = useState<LatestCommitInfo | null>(
        null,
    );
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
        builds[0]?.repo_url || project.repo || repoUrl.trim() || null;

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

    const resetForm = () => {
        setRepoUrl("");
        setGitToken("");
        setFramework("vite");
        setBuildCommand("pnpm build");
        setOutputDir("dist");
        setEnvVarsText("");
        setError("");
    };

    const handleTrigger = async () => {
        const url = repoUrl.trim();
        if (!url) {
            setError("Enter a GitHub repository URL");
            return;
        }
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
            setError("Enter a valid public GitHub repository URL");
            return;
        }
        setIsTriggering(true);
        setError("");
        try {
            const envVars = parseEnvVars(envVarsText);
            await apiClient.triggerBuild({
                pageId: project.id,
                repoUrl: url,
                gitProvider: "github",
                ...(gitToken.trim() ? { gitToken: gitToken.trim() } : {}),
                framework: framework.trim() || "vite",
                ...(buildCommand.trim()
                    ? { buildCommand: buildCommand.trim() }
                    : {}),
                ...(outputDir.trim() ? { outputDir: outputDir.trim() } : {}),
                ...(Object.keys(envVars).length > 0 ? { envVars } : {}),
            });
            toast.success("Build queued");
            setShowTrigger(false);
            resetForm();
            loadBuilds();
        } catch (triggerError) {
            const message =
                triggerError instanceof Error
                    ? triggerError.message
                    : "Failed to trigger build";
            setError(message);
            toast.error(message);
        } finally {
            setIsTriggering(false);
        }
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
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Cloud Builds
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Build your git repository and deploy the output
                                to production
                            </CardDescription>
                        </div>
                        {!showTrigger && (
                            <Button
                                size="sm"
                                className="gap-2 shrink-0"
                                onClick={() => setShowTrigger(true)}
                            >
                                <Plus className="size-3.5" />
                                New Build
                            </Button>
                        )}
                    </div>
                </CardHeader>
                <CardContent className="space-y-3">
                    {showTrigger && (
                        <div className="space-y-3 rounded-none border border-border bg-muted/20 p-4">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium text-foreground">
                                    Trigger a build
                                </p>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="size-7"
                                    onClick={() => {
                                        setShowTrigger(false);
                                        setError("");
                                    }}
                                >
                                    <X className="size-3.5" />
                                </Button>
                            </div>

                            <div className="flex items-center gap-2">
                                <GithubIcon className="size-5 shrink-0 text-muted-foreground" />
                                <div className="relative flex-1">
                                    <Input
                                        id="build-repo"
                                        placeholder="https://github.com/user/repo"
                                        value={repoUrl}
                                        onChange={(e) => {
                                            setRepoUrl(e.target.value);
                                            setError("");
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter")
                                                handleTrigger();
                                        }}
                                        className="h-10 pr-24 font-mono text-sm"
                                    />
                                    <Button
                                        size="sm"
                                        className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-3"
                                        onClick={handleTrigger}
                                        disabled={isTriggering}
                                    >
                                        {isTriggering ? (
                                            <Spinner size="inline" />
                                        ) : (
                                            <Play className="size-3.5" />
                                        )}
                                        Build
                                    </Button>
                                </div>
                            </div>
                            <p className="text-xs text-muted-foreground">
                                Deploy a public GitHub repository. Paste a repo
                                URL and click Build — the output will be
                                deployed automatically.
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-framework">
                                        Framework
                                    </Label>
                                    <Input
                                        id="build-framework"
                                        placeholder="vite"
                                        value={framework}
                                        onChange={(e) =>
                                            setFramework(e.target.value)
                                        }
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-command">
                                        Build command
                                    </Label>
                                    <Input
                                        id="build-command"
                                        placeholder="pnpm build"
                                        value={buildCommand}
                                        onChange={(e) =>
                                            setBuildCommand(e.target.value)
                                        }
                                        className="font-mono text-xs"
                                    />
                                </div>
                                <div className="space-y-1.5">
                                    <Label htmlFor="build-output">
                                        Output directory
                                    </Label>
                                    <Input
                                        id="build-output"
                                        placeholder="dist"
                                        value={outputDir}
                                        onChange={(e) =>
                                            setOutputDir(e.target.value)
                                        }
                                        className="font-mono text-xs"
                                    />
                                </div>
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="build-token">
                                    Git token (for private repos)
                                </Label>
                                <Input
                                    id="build-token"
                                    type="password"
                                    placeholder="ghp_…"
                                    value={gitToken}
                                    onChange={(e) =>
                                        setGitToken(e.target.value)
                                    }
                                    className="font-mono text-xs"
                                />
                            </div>

                            <div className="space-y-1.5">
                                <Label htmlFor="build-env">
                                    Environment variables (KEY=VALUE per line)
                                </Label>
                                <Textarea
                                    id="build-env"
                                    rows={3}
                                    placeholder={
                                        "VITE_API_URL=https://api.example.com\nNODE_ENV=production"
                                    }
                                    value={envVarsText}
                                    onChange={(e) =>
                                        setEnvVarsText(e.target.value)
                                    }
                                    className="font-mono text-xs"
                                />
                            </div>

                            {error && (
                                <p className="text-xs text-destructive">
                                    {error}
                                </p>
                            )}

                            <div className="flex items-center justify-end gap-2">
                                <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() => {
                                        setShowTrigger(false);
                                        setError("");
                                    }}
                                >
                                    Cancel
                                </Button>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner size="inline" />
                        </div>
                    ) : builds.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No builds yet. Trigger a cloud build from your git
                            repository.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {builds.map((build) => {
                                const config =
                                    buildStatusConfig[build.status] ??
                                    buildStatusConfig.queued;
                                return (
                                    <div
                                        key={build.id}
                                        className="rounded-none border border-border p-3"
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="flex size-8 shrink-0 items-center justify-center rounded-none bg-muted">
                                                {build.status === "active" ? (
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
                                                        variant={config.variant}
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
                                                            {latestCommit.message}
                                                        </p>
                                                    )}
                                            </div>
                                            <span className="shrink-0 text-xs text-muted-foreground">
                                                {formatRelativeTime(
                                                    build.created_at,
                                                )}
                                            </span>
                                        </div>
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

function AnalyticsTab({ project }: { project: Project }) {
    const [usage, setUsage] = useState<ApiUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const loadUsage = useCallback(
        async (quiet = false) => {
            if (!project.domain) return;
            if (quiet) setRefreshing(true);
            else setLoading(true);
            setError("");
            try {
                const data = await apiClient.getPageUsage(project.domain);
                setUsage(data);
                setLastUpdated(new Date());
            } catch (err) {
                if (!quiet) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load analytics",
                    );
                }
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [project.domain],
    );

    useEffect(() => {
        loadUsage();
        if (!project.domain) return;
        const id = window.setInterval(() => loadUsage(true), 15_000);
        return () => window.clearInterval(id);
    }, [loadUsage, project.domain]);

    if (!project.domain) {
        return (
            <Card>
                <CardContent className="py-12">
                    <p className="text-sm text-muted-foreground text-center">
                        Assign a domain to view analytics for this project.
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (loading && !usage) {
        return (
            <Card>
                <CardContent className="py-12">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Spinner size="inline" />
                        Loading analytics…
                    </div>
                </CardContent>
            </Card>
        );
    }

    if ((error || !usage) && !loading) {
        return (
            <Card>
                <CardContent className="py-12 space-y-3">
                    <p className="text-sm text-muted-foreground text-center">
                        {error || "No analytics data available."}
                    </p>
                    <div className="flex justify-center">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadUsage()}
                        >
                            Retry
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!usage) return null;

    const totalTraffic =
        (usage.traffic?.humans ?? 0) + (usage.traffic?.bots ?? 0);
    const humanPct =
        totalTraffic > 0
            ? Math.round(((usage.traffic?.humans ?? 0) / totalTraffic) * 100)
            : 0;
    const botPct = totalTraffic > 0 ? 100 - humanPct : 0;

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">Analytics</CardTitle>
                            <CardDescription className="text-xs">
                                Traffic and request breakdown for{" "}
                                {project.domain}
                                {lastUpdated
                                    ? ` · updated ${formatRelativeTime(lastUpdated.toISOString())}`
                                    : ""}
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 shrink-0"
                            onClick={() => loadUsage(true)}
                            disabled={refreshing}
                        >
                            <RefreshCw
                                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                            />
                            Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-0">
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Requests</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {usage.requests.used.toLocaleString()}
                        </p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">
                            Bandwidth
                        </p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {formatBytes(usage.bandwidth.used_bytes)}
                        </p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Humans</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {(usage.traffic?.humans ?? 0).toLocaleString()}
                        </p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Bots</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {(usage.traffic?.bots ?? 0).toLocaleString()}
                        </p>
                    </div>
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Traffic mix</CardTitle>
                    <CardDescription className="text-xs">
                        Human vs bot requests
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                    {totalTraffic === 0 ? (
                        <p className="text-sm text-muted-foreground">
                            No traffic recorded yet.
                        </p>
                    ) : (
                        <>
                            <div className="flex h-3 w-full overflow-hidden rounded-none border border-border/60">
                                <div
                                    className="h-full bg-primary transition-all"
                                    style={{ width: `${humanPct}%` }}
                                />
                                <div
                                    className="h-full bg-muted-foreground/40 transition-all"
                                    style={{ width: `${botPct}%` }}
                                />
                            </div>
                            <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="size-1.5 bg-primary" />
                                    Humans {humanPct}%
                                </span>
                                <span className="inline-flex items-center gap-1.5">
                                    <span className="size-1.5 bg-muted-foreground/40" />
                                    Bots {botPct}%
                                </span>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">
                            Request breakdown
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Flushed (DB)
                            </span>
                            <span className="tabular-nums font-medium">
                                {usage.requests.flushed.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Live (Redis)
                            </span>
                            <span className="tabular-nums font-medium">
                                {usage.requests.live.toLocaleString()}
                            </span>
                        </div>
                        <div className="flex justify-between border-t border-border pt-2">
                            <span className="text-muted-foreground">Limit</span>
                            <span className="tabular-nums font-medium">
                                {usage.requests.limit.toLocaleString()}
                            </span>
                        </div>
                    </CardContent>
                </Card>
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">
                            Bandwidth breakdown
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-2 text-sm">
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Flushed (DB)
                            </span>
                            <span className="tabular-nums font-medium">
                                {formatBytes(usage.bandwidth.flushed_bytes)}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-muted-foreground">
                                Live (Redis)
                            </span>
                            <span className="tabular-nums font-medium">
                                {formatBytes(usage.bandwidth.live_bytes)}
                            </span>
                        </div>
                        <div className="flex justify-between border-t border-border pt-2">
                            <span className="text-muted-foreground">Limit</span>
                            <span className="tabular-nums font-medium">
                                {usage.bandwidth.limit}
                            </span>
                        </div>
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}

function PerformanceTab() {
    const metrics = [
        {
            label: "Time to First Byte",
            value: "—",
            hint: "Edge latency to first byte",
        },
        {
            label: "Largest Contentful Paint",
            value: "—",
            hint: "Core Web Vital · LCP",
        },
        {
            label: "Cumulative Layout Shift",
            value: "—",
            hint: "Core Web Vital · CLS",
        },
        {
            label: "Interaction to Next Paint",
            value: "—",
            hint: "Core Web Vital · INP",
        },
        {
            label: "Cache hit ratio",
            value: "—",
            hint: "Blob / edge cache hits",
        },
        {
            label: "Error rate (5xx)",
            value: "—",
            hint: "Server errors over traffic",
        },
    ];

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Gauge className="size-4 text-muted-foreground" />
                        <div>
                            <CardTitle className="text-sm">Performance</CardTitle>
                            <CardDescription className="text-xs">
                                Real-user and edge performance metrics — coming
                                soon
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {metrics.map((m) => (
                        <div
                            key={m.label}
                            className="rounded-none border border-border bg-muted/20 p-3"
                        >
                            <p className="text-xs text-muted-foreground">
                                {m.label}
                            </p>
                            <p className="text-2xl font-semibold text-foreground mt-1 tabular-nums">
                                {m.value}
                            </p>
                            <p className="text-[11px] text-muted-foreground mt-1">
                                {m.hint}
                            </p>
                        </div>
                    ))}
                </CardContent>
            </Card>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">
                        Performance timeline
                    </CardTitle>
                    <CardDescription className="text-xs">
                        Historical charts will appear here once RUM collection
                        is enabled
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex h-40 items-end gap-1.5 border border-dashed border-border bg-muted/10 px-3 py-4">
                        {Array.from({ length: 24 }).map((_, i) => (
                            <div
                                key={i}
                                className="flex-1 rounded-none bg-muted-foreground/15"
                                style={{
                                    height: `${20 + ((i * 17) % 60)}%`,
                                }}
                            />
                        ))}
                    </div>
                    <p className="mt-3 text-center text-xs text-muted-foreground">
                        No performance samples yet
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function UsageTab({ project }: { project: Project }) {
    const [usage, setUsage] = useState<ApiUsage | null>(null);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState("");
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    const loadUsage = useCallback(
        async (quiet = false) => {
            if (!project.domain) return;
            if (quiet) setRefreshing(true);
            else setLoading(true);
            setError("");
            try {
                const data = await apiClient.getPageUsage(project.domain);
                setUsage(data);
                setLastUpdated(new Date());
                setError("");
            } catch (err) {
                if (!quiet) {
                    setError(
                        err instanceof Error
                            ? err.message
                            : "Failed to load usage",
                    );
                }
            } finally {
                setLoading(false);
                setRefreshing(false);
            }
        },
        [project.domain],
    );

    useEffect(() => {
        loadUsage();
        if (!project.domain) return;
        const id = window.setInterval(() => loadUsage(true), 10_000);
        return () => window.clearInterval(id);
    }, [loadUsage, project.domain]);

    if (!project.domain) {
        return (
            <Card>
                <CardContent className="py-12">
                    <p className="text-sm text-muted-foreground text-center">
                        Assign a domain to track usage for this project.
                    </p>
                </CardContent>
            </Card>
        );
    }

    if (loading && !usage) {
        return (
            <Card>
                <CardContent className="py-12">
                    <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                        <Spinner size="inline" />
                        Loading usage…
                    </div>
                </CardContent>
            </Card>
        );
    }

    if ((error || !usage) && !loading) {
        return (
            <Card>
                <CardContent className="py-12 space-y-3">
                    <p className="text-sm text-muted-foreground text-center">
                        {error || "No usage data available."}
                    </p>
                    <div className="flex justify-center">
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={() => loadUsage()}
                        >
                            Retry
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    }

    if (!usage) return null;

    const bandwidthUsed = usage.bandwidth.used_bytes;
    const bandwidthLimit = usage.bandwidth.limit_bytes || 1;
    const syncMinutes = Math.max(
        1,
        Math.round((usage.sync.interval_seconds || 120) / 60),
    );

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Realtime usage
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Live Redis counters + flushed DB totals
                                {lastUpdated
                                    ? ` · updated ${formatRelativeTime(lastUpdated.toISOString())}`
                                    : ""}
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            variant="outline"
                            className="gap-2 shrink-0"
                            onClick={() => loadUsage(true)}
                            disabled={refreshing}
                        >
                            <RefreshCw
                                className={`size-3.5 ${refreshing ? "animate-spin" : ""}`}
                            />
                            Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent className="space-y-3 pt-0">
                    <div className="flex flex-wrap items-center gap-2">
                        <Badge
                            variant={
                                usage.sync.pending_flush
                                    ? "secondary"
                                    : "outline"
                            }
                            className="text-xs"
                        >
                            {usage.sync.pending_flush
                                ? "Pending Redis → DB flush"
                                : "Fully flushed to DB"}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                            Blob-server flushes about every {syncMinutes} min
                        </span>
                    </div>
                    {usage.traffic && (
                        <div className="grid grid-cols-2 gap-3">
                            <div className="rounded-none border border-border bg-muted/20 p-2.5">
                                <p className="text-xs text-muted-foreground">
                                    Humans
                                </p>
                                <p className="text-sm font-medium text-foreground mt-0.5">
                                    {usage.traffic.humans.toLocaleString()}
                                </p>
                            </div>
                            <div className="rounded-none border border-border bg-muted/20 p-2.5">
                                <p className="text-xs text-muted-foreground">
                                    Bots (incl. curl)
                                </p>
                                <p className="text-sm font-medium text-foreground mt-0.5">
                                    {usage.traffic.bots.toLocaleString()}
                                </p>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Activity className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                                Requests
                            </span>
                        </div>
                        <span className="text-sm text-muted-foreground font-medium">
                            {usage.requests.used.toLocaleString()} /{" "}
                            {usage.requests.limit.toLocaleString()}
                        </span>
                    </div>
                    <CombinedUsageBar
                        flushed={usage.requests.flushed}
                        live={usage.requests.live}
                        limit={usage.requests.limit}
                        formatValue={(n) => n.toLocaleString()}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <HardDrive className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                                Bandwidth
                            </span>
                        </div>
                        <span className="text-sm text-muted-foreground font-medium">
                            {formatBytes(bandwidthUsed)} /{" "}
                            {usage.bandwidth.limit}
                        </span>
                    </div>
                    <CombinedUsageBar
                        flushed={usage.bandwidth.flushed_bytes}
                        live={usage.bandwidth.live_bytes}
                        limit={bandwidthLimit}
                        formatValue={formatBytes}
                    />
                </CardContent>
            </Card>

            <Card>
                <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <FileText className="size-4 text-muted-foreground" />
                            <span className="text-sm font-medium text-foreground">
                                App storage
                            </span>
                        </div>
                        <span className="text-sm text-muted-foreground font-medium">
                            {usage.storage.human}
                        </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                        {usage.storage.file_count.toLocaleString()} file
                        {usage.storage.file_count === 1 ? "" : "s"} in the
                        active deployment
                        {usage.storage.bytes > 0
                            ? ` (${formatBytes(usage.storage.bytes)})`
                            : ""}
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}

function SettingsTab({ project }: { project: Project }) {
    const { deleteProject } = useAppStore();
    const router = useRouter();
    const [isDeleting, setIsDeleting] = useState(false);

    const handleDelete = async () => {
        setIsDeleting(true);
        try {
            await deleteProject(project.id);
            toast.success("Project deleted");
            router.push("/projects");
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to delete project",
            );
            setIsDeleting(false);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Project Settings</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="space-y-1.5">
                        <Label>Project Name</Label>
                        <Input defaultValue={project.name} />
                    </div>
                    <div className="space-y-1.5">
                        <Label>Description</Label>
                        <Input
                            defaultValue={project.description || ""}
                            placeholder="Project description"
                        />
                    </div>
                    <Button>Save Changes</Button>
                </CardContent>
            </Card>

            <Card className="border-destructive/40">
                <CardHeader>
                    <CardTitle className="text-sm text-destructive">
                        Danger Zone
                    </CardTitle>
                    <CardDescription className="text-xs">
                        These actions are irreversible
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="flex items-center justify-between p-4 rounded-none border border-destructive/30 bg-destructive/5">
                        <div>
                            <p className="text-sm font-medium text-foreground">
                                Delete this project
                            </p>
                            <p className="text-sm text-muted-foreground mt-0.5">
                                This will permanently delete the project and all
                                its data
                            </p>
                        </div>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button
                                    variant="destructive"
                                    size="sm"
                                    disabled={isDeleting}
                                >
                                    {isDeleting ? (
                                        <Spinner size="inline" className="mr-1.5" />
                                    ) : (
                                        <Trash2 className="size-3.5 mr-1.5" />
                                    )}
                                    Delete
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>
                                        Delete {project.name}?
                                    </AlertDialogTitle>
                                    <AlertDialogDescription>
                                        This will permanently delete the
                                        project, its deployments, and all
                                        associated data. This action cannot be
                                        undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>
                                        Cancel
                                    </AlertDialogCancel>
                                    <AlertDialogAction
                                        className="bg-destructive text-white hover:bg-destructive/90"
                                        onClick={handleDelete}
                                    >
                                        Delete project
                                    </AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}

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
