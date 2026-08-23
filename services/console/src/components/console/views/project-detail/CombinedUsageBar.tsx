"use client";

export function CombinedUsageBar({
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
