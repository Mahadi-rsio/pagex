"use client";

import {
    ArrowDown,
    Check,
    ChevronUp,
    Clipboard,
    Clock,
    Terminal,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { apiClient, type BuildDoneEvent } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { parseAnsi, type AnsiSegment } from "./ansi";

interface LogLine {
    id: number;
    time: string;
    text: string;
}

const STAGE_LABELS: Record<string, string> = {
    cloning: "Cloning repo",
    installing: "Installing deps",
    building: "Building",
    deploying: "Deploying",
    ready: "Finalizing",
};

function formatElapsed(totalSeconds: number): string {
    const h = Math.floor(totalSeconds / 3600);
    const m = Math.floor((totalSeconds % 3600) / 60);
    const s = totalSeconds % 60;
    if (h > 0)
        return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function nowTime(): string {
    return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

/** Render a log line with ANSI styling. */
function renderAnsiLine(text: string) {
    const segments = parseAnsi(text);
    return segments.map((seg, i) => (
        <span
            key={i}
            style={{
                color: seg.fg,
                backgroundColor: seg.bg,
                fontWeight: seg.bold ? 700 : undefined,
                opacity: seg.dim ? 0.75 : undefined,
                fontStyle: seg.italic ? "italic" : undefined,
                textDecoration: seg.underline ? "underline" : undefined,
            }}
        >
            {seg.text}
        </span>
    ));
}

/** Fallback line class when the line has no ANSI codes but matches a marker. */
function plainLineClass(text: string): string {
    if (text.startsWith("==> Build complete") || text.startsWith("✓"))
        return "text-emerald-400";
    if (text.startsWith("==> Build failed") || text.startsWith("[error]"))
        return "text-red-400";
    if (text.startsWith("==>")) return "text-cyan-300 font-medium";
    if (/warning|warn:/i.test(text)) return "text-amber-300/90";
    return "text-zinc-400";
}

export function BuildTerminal({
    buildId,
    title,
    subtitle,
    onComplete,
    onClose,
}: {
    buildId: string;
    title: string;
    subtitle?: string;
    onComplete?: () => void;
    onClose?: () => void;
}) {
    const [lines, setLines] = useState<LogLine[]>([]);
    const [stage, setStage] = useState("");
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const [elapsed, setElapsed] = useState(0);
    const [copied, setCopied] = useState(false);
    const [stickToBottom, setStickToBottom] = useState(true);

    const scrollRef = useRef<HTMLDivElement>(null);
    const bottomRef = useRef<HTMLDivElement>(null);
    const bufferRef = useRef("");
    const lineIdRef = useRef(0);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        setLines([]);
        setStage("");
        setDone(false);
        setError("");
        setElapsed(0);
        bufferRef.current = "";

        const controller = new AbortController();

        apiClient
            .streamBuildLogs(
                buildId,
                {
                    onLog: (message) => {
                        // Append to a line buffer: SSE slices can split or join
                        // lines, so only complete "\n"-terminated lines are
                        // materialized as rows.
                        const appended = bufferRef.current + message;
                        const parts = appended.split("\n");
                        bufferRef.current = parts.pop() ?? "";
                        if (parts.length > 0) {
                            const time = nowTime();
                            const complete = parts.map((text) => ({
                                id: lineIdRef.current++,
                                time,
                                text,
                            }));
                            setLines((prev) => [...prev, ...complete]);
                        }
                    },
                    onStatus: (status) => setStage(status),
                    onDone: (event: BuildDoneEvent) => {
                        if (bufferRef.current) {
                            const time = nowTime();
                            setLines((prev) => [
                                ...prev,
                                {
                                    id: lineIdRef.current++,
                                    time,
                                    text: bufferRef.current,
                                },
                            ]);
                            bufferRef.current = "";
                        }
                        setDone(true);
                        if (event.error) {
                            setError(event.error);
                            setLines((prev) => [
                                ...prev,
                                {
                                    id: lineIdRef.current++,
                                    time: nowTime(),
                                    text: `[error] ${event.error}`,
                                },
                            ]);
                        }
                        onCompleteRef.current?.();
                    },
                    onError: (event) => {
                        setDone(true);
                        setError(event.message);
                        setLines((prev) => [
                            ...prev,
                            {
                                id: lineIdRef.current++,
                                time: nowTime(),
                                text: `[error] ${event.message}`,
                            },
                        ]);
                        onCompleteRef.current?.();
                    },
                },
                controller.signal,
            )
            .catch(() => {
                setDone(true);
                setError("Failed to connect to the build log stream");
                onCompleteRef.current?.();
            });

        return () => controller.abort();
    }, [buildId]);

    // Live elapsed timer.
    useEffect(() => {
        const startedAt = Date.now();
        const timer = setInterval(() => {
            setElapsed(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => clearInterval(timer);
    }, [buildId]);

    // Stick-to-bottom scrolling.
    useEffect(() => {
        if (!stickToBottom) return;
        bottomRef.current?.scrollIntoView({ behavior: "auto" });
    }, [lines, stage, stickToBottom]);

    const handleScroll = () => {
        const el = scrollRef.current;
        if (!el) return;
        const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
        setStickToBottom(atBottom);
    };

    const handleCopy = async (event: MouseEvent) => {
        event.stopPropagation();
        try {
            await navigator.clipboard.writeText(
                lines.map((l) => l.text).join("\n"),
            );
            setCopied(true);
            setTimeout(() => setCopied(false), 1600);
        } catch {
            /* clipboard unavailable */
        }
    };

    const statusLabel = useMemo(() => {
        if (done) return error ? "Failed" : "Complete";
        if (stage) return STAGE_LABELS[stage] ?? stage;
        return "Streaming…";
    }, [done, error, stage]);

    const logText = useMemo(() => lines.map((l) => l.text).join("\n"), [lines]);

    return (
        <div className="w-full overflow-hidden rounded-lg border border-zinc-800 bg-[#0a0e14] font-mono text-xs leading-relaxed text-zinc-300 shadow-[0_24px_64px_-32px_oklch(0_0_0/0.9)]">
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-zinc-800 bg-[#0e131b] px-3 py-2.5 sm:px-4">
                <div className="flex min-w-0 items-center gap-3">
                    <div className="hidden shrink-0 items-center gap-1.5 sm:flex">
                        <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                        <span className="size-2.5 rounded-full bg-[#febc2e]" />
                        <span className="size-2.5 rounded-full bg-[#28c840]" />
                    </div>
                    <Terminal className="size-4 shrink-0 text-zinc-400" />
                    <div className="min-w-0">
                        <p className="truncate font-sans text-sm font-medium text-zinc-100">
                            {title}
                        </p>
                        {subtitle && (
                            <p className="truncate font-sans text-[11px] text-zinc-500">
                                {subtitle}
                            </p>
                        )}
                    </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="hidden items-center gap-1.5 text-[11px] tabular-nums text-zinc-500 md:flex">
                        <Clock className="size-3" />
                        {formatElapsed(elapsed)}
                    </span>
                    <Badge
                        variant="outline"
                        className={cn(
                            "border-zinc-700 bg-zinc-800/60 font-sans text-[11px]",
                            done
                                ? error
                                    ? "text-red-400"
                                    : "text-emerald-400"
                                : "text-zinc-200",
                        )}
                    >
                        <span
                            className={cn(
                                "mr-1 inline-block size-1.5 rounded-full",
                                done
                                    ? error
                                        ? "bg-red-400"
                                        : "bg-emerald-400"
                                    : "animate-pulse bg-cyan-300",
                            )}
                        />
                        {statusLabel}
                    </Badge>
                    <Button
                        variant="ghost"
                        size="icon"
                        className="size-7 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                        onClick={handleCopy}
                        aria-label="Copy build log"
                        title="Copy build log"
                    >
                        {copied ? (
                            <Check className="size-3.5 text-emerald-400" />
                        ) : (
                            <Clipboard className="size-3.5" />
                        )}
                    </Button>
                    {onClose && (
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-7 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200"
                            onClick={onClose}
                            aria-label="Close build logs"
                            title="Close build logs"
                        >
                            <ChevronUp className="size-3.5" />
                        </Button>
                    )}
                </div>
            </div>

            {/* Log body */}
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className="relative h-[min(58vh,34rem)] min-h-[20rem] overflow-y-auto overscroll-contain"
            >
                <div className="min-w-[max-content] px-3 py-3 sm:px-4">
                    {lines.map((line) => {
                        const hasAnsi = line.text.includes("\x1b");
                        return (
                            <div
                                key={line.id}
                                className="flex gap-3 py-px hover:bg-white/[0.02]"
                            >
                                <span className="w-20 shrink-0 select-none text-right text-[10px] leading-[inherit] text-zinc-600 tabular-nums">
                                    {line.time}
                                </span>
                                <span
                                    className={cn(
                                        "min-w-0 whitespace-pre-wrap break-words text-[12px] leading-[1.6]",
                                        !hasAnsi && plainLineClass(line.text),
                                    )}
                                >
                                    {renderAnsiLine(line.text)}
                                </span>
                            </div>
                        );
                    })}
                    {lines.length === 0 && (
                        <div className="flex items-center gap-2 py-2 text-zinc-600">
                            <span className="size-1.5 animate-pulse rounded-full bg-cyan-300" />
                            Waiting for build logs…
                        </div>
                    )}
                    {!done && (
                        <div className="flex gap-3 py-px">
                            <span className="w-20 shrink-0 text-right text-[10px] tabular-nums text-zinc-600">
                                {nowTime()}
                            </span>
                            <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-100" />
                        </div>
                    )}
                    <div ref={bottomRef} />
                </div>

                {/* Jump-to-latest overlay when scrolled up */}
                {!stickToBottom && (
                    <button
                        type="button"
                        onClick={() => {
                            bottomRef.current?.scrollIntoView({
                                behavior: "smooth",
                            });
                            setStickToBottom(true);
                        }}
                        className="absolute bottom-3 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-700 bg-zinc-900/95 px-3 py-1.5 font-sans text-[11px] text-zinc-200 shadow-lg transition-colors hover:bg-zinc-800"
                    >
                        <ArrowDown className="size-3" />
                        Jump to latest
                    </button>
                )}
            </div>

            {/* Footer status strip */}
            <div className="flex items-center justify-between border-t border-zinc-800 bg-[#0e131b] px-3 py-1.5 font-sans text-[10px] text-zinc-600 sm:px-4">
                <span className="truncate">
                    {done
                        ? error
                            ? `Failed: ${error}`
                            : "Build completed"
                        : `Streaming ${stage ? (STAGE_LABELS[stage] ?? stage) : "logs"}…`}
                </span>
                <span className="ml-3 shrink-0 tabular-nums">
                    {lines.length} lines · {formatElapsed(elapsed)}
                </span>
            </div>
        </div>
    );
}

export type { LogLine };
