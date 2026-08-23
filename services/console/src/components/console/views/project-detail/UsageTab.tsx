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
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    apiClient,
    type ApiUsage,
} from "@/lib/api-client";
import {
    HardDrive,
    Activity,
    RefreshCw,
    FileText,
} from "lucide-react";

import { CombinedUsageBar } from "./CombinedUsageBar";
import {
    formatBytes,
} from "./utils";

export function UsageTab({ project }: { project: Project }) {
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

