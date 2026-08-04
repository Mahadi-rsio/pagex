import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import * as React from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full border border-transparent text-sm font-medium whitespace-nowrap transition-all duration-200 outline-none select-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] aria-invalid:border-destructive aria-invalid:ring-[3px] aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
    {
        variants: {
            variant: {
                default:
                    "bg-primary text-primary-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.14),0_10px_28px_-14px_oklch(0_0_0/0.6)] hover:bg-primary/85 hover:shadow-[inset_0_1px_0_0_oklch(1_0_0/0.14),0_14px_36px_-12px_oklch(0_0_0/0.65)] dark:shadow-[inset_0_1px_0_0_oklch(1_0_0/0.2),0_10px_28px_-14px_oklch(0_0_0/0.8)] dark:hover:shadow-[inset_0_1px_0_0_oklch(1_0_0/0.2),0_14px_36px_-12px_oklch(0_0_0/0.85)]",
                outline:
                    "border-border bg-background/60 text-foreground backdrop-blur-sm hover:border-foreground/40 hover:bg-muted/60 hover:text-foreground dark:border-input dark:bg-input/10 dark:hover:bg-input/30",
                secondary:
                    "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_0_oklch(1_0_0/0.1)] hover:bg-secondary/70",
                ghost: "text-muted-foreground hover:bg-muted hover:text-foreground dark:hover:bg-muted/60",
                destructive:
                    "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
                link: "text-foreground underline-offset-4 hover:underline",
            },
            size: {
                default: "h-8 gap-1.5 px-3.5 has-[>svg]:px-2.5",
                sm: "h-7 gap-1 px-2.5 text-[0.8rem] has-[>svg]:px-2",
                lg: "h-10 gap-1.5 px-5 text-[0.9rem] has-[>svg]:px-3.5",
                icon: "size-8",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    },
);

function Button({
    className,
    variant,
    size,
    asChild = false,
    ...props
}: React.ComponentProps<"button"> &
    VariantProps<typeof buttonVariants> & {
        asChild?: boolean;
    }) {
    const Comp = asChild ? Slot : "button";

    return (
        <Comp
            data-slot="button"
            className={cn(buttonVariants({ variant, size, className }))}
            {...props}
        />
    );
}

export { Button, buttonVariants };
