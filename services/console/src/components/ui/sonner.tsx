"use client";

import {
    CircleCheckIcon,
    InfoIcon,
    OctagonXIcon,
    TriangleAlertIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import type * as React from "react";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Spinner } from "@/components/ui/spinner";

const Toaster = ({ ...props }: ToasterProps) => {
    const { theme = "system" } = useTheme();

    return (
        <Sonner
            theme={theme as ToasterProps["theme"]}
            className="toaster group"
            position="bottom-right"
            gap={12}
            offset={20}
            visibleToasts={4}
            toastOptions={{
                classNames: {
                    toast: "group toast",
                    title: "text-sm font-semibold tracking-tight",
                    description: "text-xs text-muted-foreground",
                    actionButton:
                        "rounded-none border border-border bg-foreground text-background text-xs font-medium",
                    cancelButton:
                        "rounded-none border border-border bg-muted text-foreground text-xs",
                },
            }}
            icons={{
                success: <CircleCheckIcon className="size-4 text-foreground" />,
                info: <InfoIcon className="size-4 text-foreground" />,
                warning: (
                    <TriangleAlertIcon className="size-4 text-foreground" />
                ),
                error: <OctagonXIcon className="size-4 text-destructive" />,
                loading: <Spinner size="inline" className="shrink-0" />,
            }}
            style={
                {
                    "--border-radius": "0",
                } as React.CSSProperties
            }
            {...props}
        />
    );
};

export { Toaster };
