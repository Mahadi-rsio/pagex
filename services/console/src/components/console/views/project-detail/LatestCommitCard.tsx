"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Spinner } from "@/components/ui/spinner";
import { GitCommitHorizontal } from "lucide-react";
import { formatRelativeTime } from "@/lib/utils";
import type { LatestCommitInfo } from "./utils";

export function LatestCommitCard({
    commit,
    repoUrl,
    loading,
}: {
    commit: LatestCommitInfo | null;
    repoUrl: string | null;
    loading: boolean;
}) {
    return (
        <Card>
            <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                    <GitCommitHorizontal className="size-4 text-muted-foreground" />
                    <CardTitle className="text-sm">Latest commit</CardTitle>
                </div>
                <CardDescription className="text-xs">
                    {repoUrl
                        ? `From ${repoUrl.replace(/^https?:\/\//, "")}`
                        : "Connect a GitHub repository to show the latest commit"}
                </CardDescription>
            </CardHeader>
            <CardContent>
                {loading ? (
                    <div className="flex items-center gap-2 py-2 text-sm text-muted-foreground">
                        <Spinner size="inline" />
                        Loading commit…
                    </div>
                ) : !repoUrl ? (
                    <p className="text-sm text-muted-foreground">
                        No repository linked yet. Trigger a build to associate a
                        repo.
                    </p>
                ) : !commit ? (
                    <p className="text-sm text-muted-foreground">
                        Could not load the latest commit. The repo may be
                        private or unavailable.
                    </p>
                ) : (
                    <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                            <a
                                href={commit.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="font-mono text-xs text-primary hover:underline"
                            >
                                {commit.shortSha}
                            </a>
                            <span className="text-sm font-medium text-foreground">
                                {commit.message}
                            </span>
                        </div>
                        <p className="text-xs text-muted-foreground">
                            {commit.author}
                            {commit.date
                                ? ` · ${formatRelativeTime(commit.date)}`
                                : ""}
                        </p>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

