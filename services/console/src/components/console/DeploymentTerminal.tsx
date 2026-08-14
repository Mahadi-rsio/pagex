"use client";

import { ChevronDown, ChevronUp, Copy, Eraser, Loader2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn, formatLogTimestamp } from "@/lib/utils";

export type TerminalLevel = "command" | "info" | "success" | "warn" | "error";

export interface TerminalLine {
    id: string;
    text: string;
    timestamp: string;
    level?: TerminalLevel;
}

export interface DeploymentTerminalProps {
    title?: string;
    lines: TerminalLine[];
    running?: boolean;
    status?: string;
    progress?: number;
    onCopy?: () => void;
    onClear?: () => void;
    collapsible?: boolean;
    collapsed?: boolean;
    onToggleCollapse?: () => void;
    maxHeightClass?: string;
    emptyText?: string;
}

const TERMINAL_BG = "#060607";
const TERMINAL_SURFACE = "#0c0c0e";

function LevelGlyph({ level }: { level: TerminalLevel }) {
    const glyph =
        level === "command"
            ? "$"
            : level === "info"
              ? "›"
              : level === "success"
                ? "✓"
                : level === "warn"
                  ? "!"
                  : "✕";
    return (
        <span
            className={cn(
                "inline-flex w-4 shrink-0 items-center justify-center text-[10px] leading-none",
                level === "command" && "text-white",
                level === "info" && "text-white/50",
                level === "success" && "text-white",
                level === "warn" && "text-white/80",
                level === "error" && "font-bold text-white",
            )}
        >
            {glyph}
        </span>
    );
}

export function DeploymentTerminal({
    title = "pagex · terminal",
    lines,
    running = false,
    status = "",
    progress,
    onCopy,
    onClear,
    collapsible = false,
    collapsed = false,
    onToggleCollapse,
    maxHeightClass = "max-h-80",
    emptyText = "Awaiting output…",
}: DeploymentTerminalProps) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [clock, setClock] = useState(() =>
        new Date().toLocaleTimeString("en-GB"),
    );

    useEffect(() => {
        const id = window.setInterval(() => {
            setClock(new Date().toLocaleTimeString("en-GB"));
        }, 1000);
        return () => window.clearInterval(id);
    }, []);

    useEffect(() => {
        if (collapsed) return;
        const el = scrollRef.current;
        if (el && lines.length > 0) el.scrollTop = el.scrollHeight;
    }, [collapsed, lines.length]);

    return (
        <div
            className="scan-line group relative overflow-hidden rounded-xl border border-white/10 shadow-[0_0_0_1px_rgba(255,255,255,0.04),0_24px_64px_-24px_rgba(0,0,0,0.8),0_0_40px_-12px_rgba(255,255,255,0.06)_inset]"
            style={{
                background: TERMINAL_BG,
                fontFamily:
                    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            }}
        >
            {/* Corner brackets */}
            <span className="pointer-events-none absolute left-2 top-2 text-[10px] leading-none text-white/25">
                ┌
            </span>
            <span className="pointer-events-none absolute right-2 top-2 text-[10px] leading-none text-white/25">
                ┐
            </span>
            <span className="pointer-events-none absolute bottom-2 left-2 text-[10px] leading-none text-white/25">
                └
            </span>
            <span className="pointer-events-none absolute bottom-2 right-2 text-[10px] leading-none text-white/25">
                ┘
            </span>

            {/* Grid backdrop */}
            <div
                className="pointer-events-none absolute inset-0"
                style={{
                    backgroundImage:
                        "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
                    backgroundSize: "32px 32px",
                }}
            />

            {/* Header */}
            <div
                className="relative flex items-center justify-between gap-3 border-b border-white/10 px-3 py-2"
                style={{ background: TERMINAL_SURFACE }}
            >
                <div className="flex min-w-0 items-center gap-2.5">
                    <span className="flex shrink-0 gap-1.5">
                        <span className="size-2 rounded-full bg-white/20" />
                        <span className="size-2 rounded-full bg-white/20" />
                        <span className="size-2 rounded-full bg-white/20" />
                    </span>
                    <span className="truncate text-[10px] font-medium uppercase tracking-[0.2em] text-white/60">
                        {title}
                    </span>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                    <span className="text-[10px] tabular-nums tracking-widest text-white/35">
                        {clock}
                    </span>
                    {onCopy && (
                        <button
                            type="button"
                            onClick={onCopy}
                            aria-label="Copy output"
                            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <Copy className="size-3" />
                        </button>
                    )}
                    {onClear && (
                        <button
                            type="button"
                            onClick={onClear}
                            aria-label="Clear output"
                            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            <Eraser className="size-3" />
                        </button>
                    )}
                    {collapsible && onToggleCollapse && (
                        <button
                            type="button"
                            onClick={onToggleCollapse}
                            aria-label={
                                collapsed ? "Expand output" : "Collapse output"
                            }
                            className="rounded p-1 text-white/40 transition-colors hover:bg-white/10 hover:text-white"
                        >
                            {collapsed ? (
                                <ChevronUp className="size-3" />
                            ) : (
                                <ChevronDown className="size-3" />
                            )}
                        </button>
                    )}
                </div>
            </div>

            {/* Body */}
            {!collapsed && (
                <div
                    ref={scrollRef}
                    className={cn(
                        "relative overflow-y-auto px-3 py-2.5 text-xs leading-6",
                        maxHeightClass,
                    )}
                >
                    {lines.length === 0 ? (
                        <p className="select-none text-white/25">
                            {emptyText}
                            {running && (
                                <span className="ml-1 animate-pulse">▊</span>
                            )}
                        </p>
                    ) : (
                        <div className="space-y-px">
                            {lines.map((line) => {
                                const level = line.level ?? "info";
                                const isCommand = level === "command";
                                return (
                                    <div
                                        key={line.id}
                                        className="flex gap-3 whitespace-pre-wrap break-all"
                                    >
                                        <span
                                            className={cn(
                                                "w-[9ch] shrink-0 select-none text-right tabular-nums leading-6",
                                                isCommand
                                                    ? "text-white/70"
                                                    : "text-white/25",
                                            )}
                                        >
                                            {formatLogTimestamp(line.timestamp)}
                                        </span>
                                        <span className="shrink-0 select-none leading-6">
                                            <LevelGlyph level={level} />
                                        </span>
                                        <span
                                            className={cn(
                                                "min-w-0 flex-1 leading-6",
                                                isCommand && "text-white/90",
                                                level === "info" &&
                                                    "text-white/55",
                                                level === "success" &&
                                                    "text-white/80",
                                                level === "warn" &&
                                                    "text-white/70",
                                                level === "error" &&
                                                    "font-semibold text-white",
                                            )}
                                        >
                                            {line.text}
                                        </span>
                                    </div>
                                );
                            })}
                            {running && (
                                <span className="inline-block animate-pulse pl-[9ch] text-white/90">
                                    ▊
                                </span>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Footer */}
            <div
                className="relative flex items-center justify-between gap-3 border-t border-white/10 px-3 py-1.5"
                style={{ background: TERMINAL_SURFACE }}
            >
                <span className="flex min-w-0 items-center gap-1.5 text-[10px] text-white/50">
                    {running ? (
                        <>
                            <Loader2 className="size-3 animate-spin text-white/80" />
                            <span className="truncate">
                                {status || "running…"}
                            </span>
                        </>
                    ) : (
                        <>
                            <span className="size-1.5 rounded-full bg-white/40" />
                            <span className="truncate">{status || "idle"}</span>
                        </>
                    )}
                </span>
                {typeof progress === "number" && (
                    <div className="flex shrink-0 items-center gap-2">
                        <div className="h-1 w-24 overflow-hidden rounded-full bg-white/10">
                            <div
                                className="h-full bg-white/80 transition-[width] duration-300"
                                style={{
                                    width: `${Math.max(0, Math.min(100, progress))}%`,
                                }}
                            />
                        </div>
                        <span className="text-[10px] tabular-nums text-white/60">
                            {Math.round(progress)}%
                        </span>
                    </div>
                )}
            </div>
        </div>
    );
}
