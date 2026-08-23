"use client";

import { useCallback, useEffect, useState } from "react";
import type { Project } from "@/store/useAppStore";
import { Spinner } from "@/components/ui/spinner";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
    apiClient,
} from "@/lib/api-client";
import { Tree, type TreeViewElement } from "@/components/ui/file-tree";
import { toast } from "sonner";
import {
    RefreshCw,
} from "lucide-react";

import {
    formatBytes,
    pathsToTreeElements,
    topLevelExpandedIds,
} from "./utils";

export function FilesTab({ project }: { project: Project }) {
    const [loading, setLoading] = useState(true);
    const [elements, setElements] = useState<TreeViewElement[]>([]);
    const [deploymentVersion, setDeploymentVersion] = useState<number | null>(
        null,
    );
    const [fileCount, setFileCount] = useState(0);
    const [totalSize, setTotalSize] = useState(0);

    const loadFiles = useCallback(async () => {
        setLoading(true);
        try {
            const result = await apiClient.getDeploymentFiles(project.id);
            const visibleFiles = result.files.filter(
                (f) => !/\.(br|gz)$/i.test(f.path),
            );
            setElements(pathsToTreeElements(visibleFiles.map((f) => f.path)));
            setDeploymentVersion(result.deployment?.version ?? null);
            setFileCount(visibleFiles.length);
            setTotalSize(
                visibleFiles.reduce((sum, f) => sum + (f.size || 0), 0),
            );
        } catch (error) {
            toast.error(
                error instanceof Error
                    ? error.message
                    : "Failed to load deployment files",
            );
            setElements([]);
            setDeploymentVersion(null);
            setFileCount(0);
            setTotalSize(0);
        } finally {
            setLoading(false);
        }
    }, [project.id]);

    useEffect(() => {
        loadFiles();
    }, [loadFiles]);

    return (
        <div className="space-y-4">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between gap-3">
                        <div>
                            <CardTitle className="text-sm">Files</CardTitle>
                            <CardDescription className="text-xs">
                                {deploymentVersion != null
                                    ? `Deployment v${deploymentVersion} · ${fileCount} file${fileCount === 1 ? "" : "s"} · ${formatBytes(totalSize)}`
                                    : "Browse project files from latest deployment"}
                            </CardDescription>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                size="sm"
                                variant="outline"
                                className="gap-2"
                                onClick={loadFiles}
                                disabled={loading}
                            >
                                <RefreshCw
                                    className={`size-3.5 ${loading ? "animate-spin" : ""}`}
                                />
                                Refresh
                            </Button>
                        </div>
                    </div>
                </CardHeader>
                <CardContent>
                    {loading ? (
                        <div className="flex h-80 items-center justify-center rounded-none border border-border bg-muted/20">
                            <Spinner size="default" />
                        </div>
                    ) : elements.length === 0 ? (
                        <div className="flex h-80 items-center justify-center rounded-none border border-border bg-muted/20">
                            <p className="text-sm text-muted-foreground">
                                No deployed files yet.
                            </p>
                        </div>
                    ) : (
                        <div className="h-80 rounded-none border border-border bg-muted/20 p-2">
                            <Tree
                                elements={elements}
                                initialExpandedItems={topLevelExpandedIds(
                                    elements,
                                )}
                                className="h-full"
                            />
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}

