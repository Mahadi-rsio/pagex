"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { CheckCircle2, Cloud } from "lucide-react";
import { GithubIcon } from "./GithubIcon";
import { LiveBuildTerminal } from "./LiveBuildTerminal";

type CloudDeployPanelProps = {
    showBuild: boolean;
    slugName: string;
    repoUrl: string;
    repoError: string;
    buildError: string;
    activeBuildId: string | null;
    isDeploying: boolean;
    onRepoUrlChange: (value: string) => void;
    onDeploy: () => void;
    onBuildComplete: () => void;
    onViewProject: () => void;
};

export function CloudDeployPanel({
    showBuild,
    slugName,
    repoUrl,
    repoError,
    buildError,
    activeBuildId,
    isDeploying,
    onRepoUrlChange,
    onDeploy,
    onBuildComplete,
    onViewProject,
}: CloudDeployPanelProps) {
    if (showBuild) {
        return (
            <Card>
                <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                        {activeBuildId && !isDeploying ? (
                            <CheckCircle2 className="size-4 text-foreground" />
                        ) : (
                            <Spinner size="inline" />
                        )}
                        {activeBuildId && !isDeploying
                            ? "Deployment complete"
                            : "Building your project"}
                    </CardTitle>
                    <CardDescription>{repoUrl.trim()} · GitHub</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 px-6 pb-6">
                    {buildError && !activeBuildId ? (
                        <div className="rounded-none border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                            {buildError}
                        </div>
                    ) : activeBuildId ? (
                        <LiveBuildTerminal
                            projectName={slugName}
                            repoName={repoUrl.trim()}
                            buildId={activeBuildId}
                            onComplete={onBuildComplete}
                        />
                    ) : (
                        <div className="flex h-64 items-center justify-center rounded-none border border-border bg-[#0a0a0a]">
                            <div className="flex items-center gap-2 text-zinc-500">
                                <Spinner size="inline" />
                                Starting build…
                            </div>
                        </div>
                    )}
                    {!isDeploying && activeBuildId && (
                        <Button
                            onClick={onViewProject}
                            className="w-full"
                            size="lg"
                        >
                            View project
                        </Button>
                    )}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                <CardTitle className="text-base">Deploy from GitHub</CardTitle>
                <CardDescription>
                    Build and deploy a public GitHub repository with one click.
                    No account connection required.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
                <div className="flex items-center gap-2">
                    <GithubIcon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="relative flex-1">
                        <Input
                            placeholder="https://github.com/user/repo"
                            value={repoUrl}
                            onChange={(e) => onRepoUrlChange(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") onDeploy();
                            }}
                            className="h-10 pr-24 font-mono text-sm"
                        />
                        <Button
                            className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-3"
                            onClick={onDeploy}
                            disabled={isDeploying}
                        >
                            <Cloud className="size-3.5" />
                            Deploy
                        </Button>
                    </div>
                </div>
                {repoError && (
                    <p className="text-xs text-destructive">{repoError}</p>
                )}
                <p className="text-xs text-muted-foreground">
                    Paste a public GitHub repo URL. We clone it, run the build,
                    and deploy the output to your project domain.
                </p>
            </CardContent>
        </Card>
    );
}
