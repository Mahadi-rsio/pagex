"use client";

import {
    CircleCheckIcon,
    InfoIcon,
    Loader2Icon,
    OctagonXIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = "system" } = useTheme();

    return (
        <Sonner
            theme={theme as ToasterProps["theme"]}
            className="toaster group"
            position="bottom-right"
            gap={10}
            offset={16}
            toastOptions={{
                classNames: {
                    toast: "group toast shadow-lg",
                },
            }}
            icons={{
                success: (
                    <CircleCheckIcon className="size-4 text-emerald-600 dark:text-emerald-400" />
                ),
                info: <InfoIcon className="size-4 text-foreground" />,
                warning: (
                    <TriangleAlertIcon className="size-4 text-amber-600 dark:text-amber-400" />
                ),
                error: <OctagonXIcon className="size-4 text-destructive" />,
                loading: (
                    <Loader2Icon className="size-4 animate-spin text-foreground" />
                ),
            }}
            style={
                {
                    "--border-radius": "var(--radius)",
                } as React.CSSProperties
            }
            {...props}
        />
    );
};

export { Toaster };
