"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { formatRelativeTime } from "@/lib/utils";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
    apiClient,
    type ApiDeployment,
} from "@/lib/api-client";
import { toast } from "sonner";
import {
    RefreshCw,
    RotateCcw,
    MoreHorizontal,
} from "lucide-react";

export function DeployTab({ project }: { project: Project }) {
    const [deployments, setDeployments] = useState<ApiDeployment[]>([]);
    const [deploymentsLoading, setDeploymentsLoading] = useState(true);
    const [rollingBack, setRollingBack] = useState<string | null>(null);

    const loadDeployments = useCallback(async () => {
        try {
            const list = await apiClient.getDeployments(project.id);
            setDeployments(list);
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load deployments",
            );
        } finally {
            setDeploymentsLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadDeployments();
    }, [loadDeployments]);

    const handleRollback = async (deployment: ApiDeployment) => {
        if (rollingBack || deployment.is_active) return;
        if (
            !window.confirm(
                `Roll back to deployment v${deployment.version}? This will make it the live version.`,
            )
        ) {
            return;
        }
        setRollingBack(deployment.id);
        try {
            await apiClient.rollback(deployment.id);
            toast.success(`Rolled back to v${deployment.version}`);
            loadDeployments();
        } catch (error) {
            toast.error(
                error instanceof Error ? error.message : "Rollback failed",
            );
        } finally {
            setRollingBack(null);
        }
    };

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">
                                Deployment History
                            </CardTitle>
                            <CardDescription className="text-xs">
                                Roll back to any previous deployment
                            </CardDescription>
                        </div>
                        <Button
                            size="sm"
                            variant="ghost"
                            className="gap-1.5 shrink-0"
                            onClick={loadDeployments}
                        >
                            <RefreshCw className="size-3.5" />
                            Refresh
                        </Button>
                    </div>
                </CardHeader>
                <CardContent>
                    {deploymentsLoading ? (
                        <div className="flex items-center justify-center py-8">
                            <Spinner size="inline" />
                        </div>
                    ) : deployments.length === 0 ? (
                        <p className="py-8 text-center text-sm text-muted-foreground">
                            No deployments yet.
                        </p>
                    ) : (
                        <div className="space-y-2">
                            {deployments.map((deployment) => (
                                <div
                                    key={deployment.id}
                                    className="flex items-center gap-3 rounded-none border border-border p-3"
                                >
                                    <div
                                        className={`size-2 rounded-full shrink-0 ${deployment.is_active ? "bg-emerald-500" : "bg-muted-foreground/40"}`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-foreground">
                                                v{deployment.version}
                                            </p>
                                            <Badge
                                                variant={
                                                    deployment.is_active
                                                        ? "default"
                                                        : "outline"
                                                }
                                                className="text-xs"
                                            >
                                                {deployment.is_active
                                                    ? "Live"
                                                    : deployment.source}
                                            </Badge>
                                        </div>
                                        <p className="text-xs text-muted-foreground mt-0.5">
                                            {deployment.file_count} files ·{" "}
                                            {deployment.filesDeployed ?? 0}{" "}
                                            deployed /{" "}
                                            {deployment.filesReused ?? 0} reused
                                            ·{" "}
                                            {formatRelativeTime(
                                                deployment.created_at,
                                            )}
                                        </p>
                                    </div>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant="ghost"
                                                size="icon"
                                                className="size-8 shrink-0"
                                                disabled={
                                                    rollingBack ===
                                                    deployment.id
                                                }
                                                aria-label={`Actions for deployment v${deployment.version}`}
                                            >
                                                {rollingBack ===
                                                deployment.id ? (
                                                    <Spinner size="inline" />
                                                ) : (
                                                    <MoreHorizontal className="size-4" />
                                                )}
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="end"
                                            className="w-40"
                                        >
                                            <DropdownMenuItem
                                                disabled={
                                                    deployment.is_active ||
                                                    rollingBack !== null
                                                }
                                                className="cursor-pointer gap-2"
                                                onSelect={() =>
                                                    handleRollback(deployment)
                                                }
                                            >
                                                <RotateCcw className="size-3.5" />
                                                Rollback
                                            </DropdownMenuItem>
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </div>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

