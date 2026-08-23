"use client";

import { useEffect, useRef, useState } from "react";
import { apiClient, type BuildDoneEvent } from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { Terminal } from "lucide-react";

export function LiveBuildTerminal({
    projectName,
    repoName,
    buildId,
    onComplete}: {
    projectName: string;
    repoName: string;
    buildId: string;
    onComplete: () => void;
}) {
    const [lines, setLines] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        const controller = new AbortController();
        apiClient
            .streamBuildLogs(
                buildId,
                {
                    onLog: (message) => setLines((prev) => [...prev, message]),
                    onProgress: (value) => setProgress(value),
                    onDone: (event: BuildDoneEvent) => {
                        setDone(true);
                        if (event.error) {
                            setError(event.error);
                            setLines((prev) => [
                                ...prev,
                                `[error] ${event.error}`,
                            ]);
                        }
                        onCompleteRef.current();
                    },
                    onError: (event) => {
                        setDone(true);
                        setError(event.message);
                        setLines((prev) => [
                            ...prev,
                            `[error] ${event.message}`,
                        ]);
                        onCompleteRef.current();
                    }},
                controller.signal,
            )
            .catch(() => {
                setDone(true);
                setError("Failed to connect to the build log stream");
                onCompleteRef.current();
            });
        return () => controller.abort();
    }, [buildId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    const statusLabel = done
        ? error
            ? "Failed"
            : "Complete"
        : progress > 0
          ? `${Math.round(progress)}%`
          : "Building";

    return (
        <div className="scan-line overflow-hidden rounded-none border border-border bg-[#0a0a0a] font-mono text-xs leading-relaxed text-zinc-300 shadow-[0_32px_80px_-32px_oklch(0_0_0/0.75)]">
            <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-zinc-700" />
                        <span className="size-2.5 rounded-full bg-zinc-600" />
                        <span className="size-2.5 rounded-full bg-zinc-500" />
                    </div>
                    <Terminal className="size-4 text-zinc-100" />
                    <span className="font-sans text-sm font-medium text-zinc-100">
                        Build · {projectName}
                    </span>
                </div>
                <Badge
                    variant="outline"
                    className="border-white/10 bg-white/[0.04] font-sans text-xs text-zinc-300"
                >
                    {statusLabel}
                </Badge>
            </div>
            {progress > 0 && !done && (
                <div className="h-1 bg-white/[0.06]">
                    <div
                        className="h-full bg-zinc-100 transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
            <div className="h-[26rem] space-y-1.5 overflow-y-auto p-5">
                <p className="text-zinc-600">
                    <span className="select-none text-zinc-500">$</span> cloud
                    build {repoName}
                </p>
                {lines.map((line, i) => (
                    <p
                        key={`${i}-${line}`}
                        className={
                            line.startsWith("✓")
                                ? "text-zinc-100"
                                : line.startsWith(">")
                                  ? "text-zinc-300"
                                  : line.startsWith("[error]")
                                    ? "text-red-400"
                                    : "text-zinc-500"
                        }
                    >
                        {line}
                    </p>
                ))}
                {!done && (
                    <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-100" />
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}
