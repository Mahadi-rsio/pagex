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
import { Button } from "@/components/ui/button";
import {
    apiClient,
    type ApiUsage,
} from "@/lib/api-client";
import {
    RefreshCw,
} from "lucide-react";

import {
    formatBytes,
} from "./utils";

export function AnalyticsTab({ project }: { project: Project }) {
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

