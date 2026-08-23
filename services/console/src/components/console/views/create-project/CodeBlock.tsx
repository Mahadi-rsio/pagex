"use client";

import { CopyButton } from "./CopyButton";

export function CodeBlock({ code, copyLabel }: { code: string; copyLabel?: string }) {
    return (
        <div className="overflow-hidden rounded-none border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
                <span className="text-xs text-muted-foreground">Workflow</span>
                <CopyButton value={code} label={copyLabel ?? "Copy"} />
            </div>
            <pre className="max-h-80 overflow-auto bg-[#0a0a0a] p-4 font-mono text-xs leading-relaxed text-zinc-300">
                <code>{code}</code>
            </pre>
        </div>
    );
}
