"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { apiClient, type ApiUsage } from "@/lib/api-client";
import { Activity, HardDrive, RefreshCw } from "lucide-react";
import { CombinedUsageBar } from "./CombinedUsageBar";
import { formatBytes } from "./utils";

export function LiveUsageSummary({ project }: { project: Project }) {
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
                    <div className="flex items-center gap-2 pt-1 border-t border-border">
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
