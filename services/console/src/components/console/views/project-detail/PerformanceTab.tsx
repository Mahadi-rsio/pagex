"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
    Gauge,
} from "lucide-react";
import {
    ResponsiveContainer,
    LineChart,
    Line,
    AreaChart,
    Area,
    BarChart,
    Bar,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
} from "recharts";

// Mock data — replace with real RUM / edge metrics when available
const ttfbTimeline = Array.from({ length: 24 }, (_, i) => ({
    hour: `${String(i).padStart(2, "0")}:00`,
    ttfb: 80 + Math.round(Math.sin(i / 3) * 25 + Math.random() * 18),
    p95: 140 + Math.round(Math.sin(i / 2.5) * 30 + Math.random() * 20),
}));

const webVitalsDaily = [
    { day: "Mon", lcp: 1.82, cls: 0.04, inp: 88 },
    { day: "Tue", lcp: 1.75, cls: 0.05, inp: 92 },
    { day: "Wed", lcp: 1.91, cls: 0.03, inp: 85 },
    { day: "Thu", lcp: 1.68, cls: 0.06, inp: 110 },
    { day: "Fri", lcp: 1.79, cls: 0.04, inp: 95 },
    { day: "Sat", lcp: 1.62, cls: 0.02, inp: 78 },
    { day: "Sun", lcp: 1.71, cls: 0.03, inp: 82 },
];

const cacheHitData = [
    { day: "Mon", hit: 91, miss: 9 },
    { day: "Tue", hit: 93, miss: 7 },
    { day: "Wed", hit: 88, miss: 12 },
    { day: "Thu", hit: 95, miss: 5 },
    { day: "Fri", hit: 92, miss: 8 },
    { day: "Sat", hit: 96, miss: 4 },
    { day: "Sun", hit: 94, miss: 6 },
];

const errorRateData = [
    { hour: "00:00", rate: 0.12 },
    { hour: "04:00", rate: 0.08 },
    { hour: "08:00", rate: 0.21 },
    { hour: "12:00", rate: 0.35 },
    { hour: "16:00", rate: 0.18 },
    { hour: "20:00", rate: 0.09 },
];

export function PerformanceTab() {
    const metrics = [
        {
            label: "Time to First Byte",
            value: "112 ms",
            hint: "Edge latency to first byte · p50",
            badge: "Good",
            badgeVariant: "default" as const,
        },
        {
            label: "Largest Contentful Paint",
            value: "1.71 s",
            hint: "Core Web Vital · LCP · p75",
            badge: "Good",
            badgeVariant: "default" as const,
        },
        {
            label: "Cumulative Layout Shift",
            value: "0.03",
            hint: "Core Web Vital · CLS · p75",
            badge: "Good",
            badgeVariant: "default" as const,
        },
        {
            label: "Interaction to Next Paint",
            value: "82 ms",
            hint: "Core Web Vital · INP · p75",
            badge: "Good",
            badgeVariant: "default" as const,
        },
        {
            label: "Cache hit ratio",
            value: "94 %",
            hint: "Blob / edge cache hits · 24h",
            badge: "Excellent",
            badgeVariant: "secondary" as const,
        },
        {
            label: "Error rate (5xx)",
            value: "0.18 %",
            hint: "Server errors over traffic · 24h",
            badge: "Low",
            badgeVariant: "outline" as const,
        },
    ];

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center gap-2">
                        <Gauge className="size-4 text-muted-foreground" />
                        <div className="flex-1">
                            <CardTitle className="text-sm">Performance <span className="font-normal text-muted-foreground">· mock data</span></CardTitle>
                            <CardDescription className="text-xs">
                                Real-user and edge performance metrics — showing synthetic sample data until RUM is enabled
                            </CardDescription>
                        </div>
                        <Badge variant="secondary" className="text-[10px]">MOCK</Badge>
                    </div>
                </CardHeader>
                <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                    {metrics.map((m) => (
                        <div
                            key={m.label}
                            className="rounded-none border border-border bg-muted/20 p-3"
                        >
                            <div className="flex items-center justify-between">
                                <p className="text-xs text-muted-foreground">
                                    {m.label}
                                </p>
                                <Badge variant={m.badgeVariant} className="text-[10px] h-5 px-1.5">{m.badge}</Badge>
                            </div>
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
                    <CardTitle className="text-sm">TTFB over last 24h</CardTitle>
                    <CardDescription className="text-xs">Time to first byte — p50 vs p95 (mock, ms)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[240px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={ttfbTimeline}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={3} />
                                <YAxis tick={{ fontSize: 11 }} unit="ms" />
                                <Tooltip contentStyle={{ fontSize: 12 }} />
                                <Legend wrapperStyle={{ fontSize: 12 }} />
                                <Line type="monotone" dataKey="ttfb" name="p50" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
                                <Line type="monotone" dataKey="p95" name="p95" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 4" dot={false} />
                            </LineChart>
                        </ResponsiveContainer>
                    </div>
                </CardContent>
            </Card>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Web Vitals — 7 days</CardTitle>
                        <CardDescription className="text-xs">LCP (s) · CLS · INP (ms) — mock</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={webVitalsDaily}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} />
                                    <Tooltip contentStyle={{ fontSize: 12 }} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Area type="monotone" dataKey="lcp" name="LCP (s)" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.15} />
                                    <Area type="monotone" dataKey="inp" name="INP (ms)" stroke="#22c55e" fill="#22c55e" fillOpacity={0.1} />
                                </AreaChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>

                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm">Cache hit ratio — 7 days</CardTitle>
                        <CardDescription className="text-xs">Hit vs miss % — edge / blob cache (mock)</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="h-[220px] w-full">
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart data={cacheHitData}>
                                    <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                    <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                                    <YAxis tick={{ fontSize: 11 }} unit="%" domain={[0, 100]} />
                                    <Tooltip contentStyle={{ fontSize: 12 }} />
                                    <Legend wrapperStyle={{ fontSize: 12 }} />
                                    <Bar dataKey="hit" stackId="a" fill="#22c55e" name="Hit %" radius={[0, 0, 0, 0]} />
                                    <Bar dataKey="miss" stackId="a" fill="hsl(var(--muted-foreground))" name="Miss %" radius={[2, 2, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        </div>
                    </CardContent>
                </Card>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle className="text-sm">Error rate timeline</CardTitle>
                    <CardDescription className="text-xs">5xx errors as % of traffic — 24h buckets (mock)</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="h-[160px] w-full">
                        <ResponsiveContainer width="100%" height="100%">
                            <BarChart data={errorRateData}>
                                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                                <XAxis dataKey="hour" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} unit="%" />
                                <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v) => [`${v ?? 0}%`, "5xx rate"]} />
                                <Bar dataKey="rate" fill="#ef4444" radius={[2, 2, 0, 0]} />
                            </BarChart>
                        </ResponsiveContainer>
                    </div>
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                        Mock data — wire to real <code>status_codes.5xx / requests</code> when RUM ships.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
