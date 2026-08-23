"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import {
    Gauge,
} from "lucide-react";

export function PerformanceTab() {
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

