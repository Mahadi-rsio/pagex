"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Copy } from "lucide-react";

export function CopyButton({
    value,
    label = "Copy"}: {
    value: string;
    label?: string;
}) {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1500);
        } catch {
            // ignore clipboard errors
        }
    };

    return (
        <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={handleCopy}
        >
            {copied ? (
                <>
                    <CheckCircle2 className="size-3.5 text-foreground" />
                    Copied
                </>
            ) : (
                <>
                    <Copy className="size-3.5" />
                    {label}
                </>
            )}
        </Button>
    );
}
