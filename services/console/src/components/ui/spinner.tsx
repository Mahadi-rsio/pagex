"use client";

import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";

import { cn } from "@/lib/utils";

const spinnerVariants = cva("inline-flex items-center justify-center gap-1", {
    variants: {
        size: {
            sm: "gap-0.5 [&_span]:size-1",
            default: "gap-1 [&_span]:size-1.5",
            lg: "gap-1.5 [&_span]:size-2",
            inline: "gap-1 [&_span]:size-1.5",
        },
    },
    defaultVariants: {
        size: "inline",
    },
});

/**
 * Pulse-dot spinner — compact loader for buttons and dense UI.
 */
function Spinner({
    className,
    size,
    ...props
}: React.ComponentProps<"output"> & VariantProps<typeof spinnerVariants>) {
    return (
        <output
            aria-live="polite"
            aria-busy="true"
            aria-label="Loading"
            data-slot="spinner"
            className={cn(spinnerVariants({ size }), className)}
            {...props}
        >
            <span className="animate-pulse-dot rounded-none bg-current [animation-delay:0ms]" />
            <span className="animate-pulse-dot rounded-none bg-current [animation-delay:160ms]" />
            <span className="animate-pulse-dot rounded-none bg-current [animation-delay:320ms]" />
            <span className="sr-only">Loading</span>
        </output>
    );
}

export { Spinner, spinnerVariants };
