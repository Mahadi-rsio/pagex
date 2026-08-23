"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
    Users,
    Bot,
    Globe,
    Clock3,
} from "lucide-react";
import {
    ResponsiveContainer,
    PieChart,
    Pie,
    Cell,
    Tooltip,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Legend,
} from "recharts";

import {
    formatBytes,
} from "./utils";

const TRAFFIC_COLORS = ["hsl(var(--primary))", "hsl(var(--muted-foreground))"];
const STATUS_COLORS: Record<string, string> = {
    "2xx": "#22c55e",
    "3xx": "#3b82f6",
    "4xx": "#f59e0b",
    "5xx": "#ef4444",
};

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

    const trafficData = useMemo(() => {
        if (!usage?.traffic) return [];
        const humans = usage.traffic.humans ?? 0;
        const bots = usage.traffic.bots ?? 0;
        if (humans === 0 && bots === 0) return [];
        return [
            { name: "Humans", value: humans },
            { name: "Bots", value: bots },
        ];
    }, [usage]);

    const statusData = useMemo(() => {
        const sc = usage?.status_codes;
        if (!sc) return [];
        const entries = [
            { name: "2xx", value: sc["2xx"] ?? 0 },
            { name: "3xx", value: sc["3xx"] ?? 0 },
            { name: "4xx", value: sc["4xx"] ?? 0 },
            { name: "5xx", value: sc["5xx"] ?? 0 },
        ];
        if (entries.every((e) => e.value === 0)) return [];
        return entries;
    }, [usage]);

    const statusBarData = useMemo(() => {
        if (statusData.length === 0) return [];
        return statusData;
    }, [statusData]);

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
    const uniqueIps = usage.traffic?.unique_ips ?? 0;
    const peakHour = usage.peak?.hour ?? null;
    const peakReqs = usage.peak?.requests ?? 0;

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
                <CardContent className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 pt-0">
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">Requests</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {usage.requests.used.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">total</p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground">
                            Bandwidth
                        </p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {formatBytes(usage.bandwidth.used_bytes)}
                        </p>
                        <p className="text-[11px] text-muted-foreground">used</p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Users className="size-3" /> Humans</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {(usage.traffic?.humans ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{humanPct}% of traffic</p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Bot className="size-3" /> Bots</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {(usage.traffic?.bots ?? 0).toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{botPct}% of traffic</p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Globe className="size-3" /> Unique IPs</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {uniqueIps.toLocaleString()}
                        </p>
                        <p className="text-[11px] text-muted-foreground">visitors</p>
                    </div>
                    <div className="rounded-none border border-border bg-muted/20 p-3">
                        <p className="text-xs text-muted-foreground flex items-center gap-1"><Clock3 className="size-3" /> Peak hour</p>
                        <p className="text-lg font-semibold text-foreground mt-0.5 tabular-nums">
                            {peakHour ?? "—"}
                        </p>
                        <p className="text-[11px] text-muted-foreground">{peakReqs > 0 ? `${peakReqs.toLocaleString()} reqs` : "no data"}</p>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Traffic mix</CardTitle>
                        <CardDescription className="text-xs">
                            Human vs bot requests — pie chart
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {trafficData.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">
                                No traffic recorded yet.
                            </p>
                        ) : (
                            <>
                                <div className="h-[220px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={trafficData}
                                                cx="50%"
                                                cy="50%"
                                                innerRadius={55}
                                                outerRadius={85}
                                                paddingAngle={2}
                                                dataKey="value"
                                            >
                                                {trafficData.map((entry, idx) => (
                                                    <Cell key={entry.name} fill={TRAFFIC_COLORS[idx % TRAFFIC_COLORS.length]} />
                                                ))}
                                            </Pie>
                                            <Tooltip
                                                contentStyle={{ fontSize: 12, borderRadius: 0 }}
                                            />
                                            <Legend wrapperStyle={{ fontSize: 12 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="flex h-3 w-full overflow-hidden rounded-none border border-border/60 mt-2">
                                    <div
                                        className="h-full bg-primary transition-all"
                                        style={{ width: `${humanPct}%` }}
                                    />
                                    <div
                                        className="h-full bg-muted-foreground/40 transition-all"
                                        style={{ width: `${botPct}%` }}
                                    />
                                </div>
                                <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mt-2">
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="size-2 bg-primary" />
                                        Humans {humanPct}% ({(usage.traffic?.humans ?? 0).toLocaleString()})
                                    </span>
                                    <span className="inline-flex items-center gap-1.5">
                                        <span className="size-2 bg-muted-foreground/40" />
                                        Bots {botPct}% ({(usage.traffic?.bots ?? 0).toLocaleString()})
                                    </span>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Status codes</CardTitle>
                        <CardDescription className="text-xs">
                            HTTP response breakdown — pie + bar
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {statusData.length === 0 ? (
                            <p className="text-sm text-muted-foreground py-8 text-center">
                                No status data yet.
                            </p>
                        ) : (
                            <>
                                <div className="h-[220px] w-full">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <PieChart>
                                            <Pie
                                                data={statusData}
                                                cx="50%"
                                                cy="50%"
                                                outerRadius={85}
                                                dataKey="value"
                                                label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`}
                                            >
                                                {statusData.map((entry) => (
                                                    <Cell key={entry.name} fill={STATUS_COLORS[entry.name] ?? "#999"} />
                                                ))}
                                            </Pie>
                                            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 0 }} />
                                        </PieChart>
                                    </ResponsiveContainer>
                                </div>
                                <div className="h-[120px] w-full mt-2">
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={statusBarData}>
                                            <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                            <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                                            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                                            <Tooltip contentStyle={{ fontSize: 12 }} />
                                            <Bar dataKey="value" radius={[2, 2, 0, 0]}>
                                                {statusBarData.map((e) => (
                                                    <Cell key={e.name} fill={STATUS_COLORS[e.name] ?? "#999"} />
                                                ))}
                                            </Bar>
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            </>
                        )}
                    </CardContent>
                </Card>
            </div>

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
