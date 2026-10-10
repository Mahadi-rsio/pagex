"use client";

import { Cloud, Rocket } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { apiClient } from "@/lib/api-client";
import type { Project } from "@/store/useAppStore";
import { BuildTerminal } from "../../builds/BuildTerminal";
import { GithubIcon } from "../create-project/GithubIcon";

const FRAMEWORK_PRESETS = [
    "auto",
    "astro",
    "next",
    "vite",
    "nuxt",
    "svelte-kit",
    "cra",
] as const;

type TriggerBuildCardProps = {
    project: Project;
    defaultRepoUrl?: string | null;
    defaultBranch?: string | null;
    defaultFramework?: string | null;
    onBuildCreated: () => void;
};

export function TriggerBuildCard({
    project,
    defaultRepoUrl,
    defaultBranch,
    defaultFramework,
    onBuildCreated,
}: TriggerBuildCardProps) {
    const [mode, setMode] = useState<"form" | "building">("form");
    const [repoUrl, setRepoUrl] = useState(defaultRepoUrl ?? "");
    const [repoError, setRepoError] = useState("");
    const [branch, setBranch] = useState(defaultBranch ?? "");
    const [framework, setFramework] = useState(
        defaultFramework && defaultFramework !== "auto"
            ? defaultFramework
            : "auto",
    );
    const [buildCommand, setBuildCommand] = useState("");
    const [outputDir, setOutputDir] = useState("");
    const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
    const [isTriggering, setIsTriggering] = useState(false);
    const [buildError, setBuildError] = useState("");

    const handleTrigger = async () => {
        const url = repoUrl.trim();
        if (!url) {
            setRepoError("Enter a GitHub repository URL");
            return;
        }
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
            setRepoError("Enter a valid public GitHub repository URL");
            return;
        }
        if (isTriggering) return;
        setRepoError("");
        setBuildError("");
        setIsTriggering(true);
        try {
            const trimmedBranch = branch.trim();
            const trimmedBuildCommand = buildCommand.trim();
            const trimmedOutputDir = outputDir.trim();
            const build = await apiClient.triggerBuild({
                pageId: project.id,
                repoUrl: url,
                gitProvider: "github",
                ...(trimmedBranch ? { branch: trimmedBranch } : {}),
                framework,
                ...(trimmedBuildCommand
                    ? { buildCommand: trimmedBuildCommand }
                    : {}),
                ...(trimmedOutputDir ? { outputDir: trimmedOutputDir } : {}),
            });
            setActiveBuildId(build.id);
            setMode("building");
        } catch (err) {
            const message =
                err instanceof Error
                    ? err.message
                    : "Failed to trigger the build";
            setBuildError(message);
            toast.error(message);
            setIsTriggering(false);
        }
    };

    const handleBuildComplete = () => {
        setIsTriggering(false);
        setMode("form");
        setActiveBuildId(null);
        onBuildCreated();
    };

    if (mode === "building") {
        return (
            <Card>
                <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                    <CardTitle className="flex items-center gap-2 text-base">
                        {activeBuildId ? (
                            <Rocket className="size-4 text-foreground" />
                        ) : (
                            <Spinner size="inline" />
                        )}
                        Building {project.name}
                    </CardTitle>
                    <CardDescription>
                        {repoUrl.trim()} · GitHub · {framework}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4 px-6 pb-6">
                    {activeBuildId ? (
                        <BuildTerminal
                            buildId={activeBuildId}
                            title={`Build · ${project.name}`}
                            subtitle={`${repoUrl.trim()} · GitHub · ${framework}`}
                            onComplete={handleBuildComplete}
                        />
                    ) : (
                        <div className="flex h-64 items-center justify-center rounded-none border border-border bg-[#0a0a0a]">
                            <div className="flex items-center gap-2 text-zinc-500">
                                <Spinner size="inline" />
                                Starting build…
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        );
    }

    return (
        <Card>
            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                <CardTitle className="text-base">
                    {defaultRepoUrl ? "New build" : "First build"}
                </CardTitle>
                <CardDescription>
                    {defaultRepoUrl
                        ? "Trigger a new cloud build from your git repository."
                        : "Connect a public GitHub repository to deploy it from the cloud."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
                <div className="flex items-center gap-2">
                    <GithubIcon className="size-5 shrink-0 text-muted-foreground" />
                    <div className="relative flex-1">
                        <Input
                            placeholder="https://github.com/user/repo"
                            value={repoUrl}
                            onChange={(e) => {
                                setRepoUrl(e.target.value);
                                setRepoError("");
                            }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleTrigger();
                            }}
                            className="h-10 pr-24 font-mono text-sm"
                        />
                        <Button
                            className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-3"
                            onClick={handleTrigger}
                            disabled={isTriggering}
                        >
                            {isTriggering ? (
                                <Spinner size="inline" />
                            ) : (
                                <Cloud className="size-3.5" />
                            )}
                            {defaultRepoUrl ? "Build" : "Deploy"}
                        </Button>
                    </div>
                </div>
                {repoError && (
                    <p className="text-xs text-destructive">{repoError}</p>
                )}
                {buildError && (
                    <p className="text-xs text-destructive">{buildError}</p>
                )}
                <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
                    <div className="flex flex-1 items-center gap-2">
                        <Input
                            placeholder="main"
                            value={branch}
                            onChange={(e) => setBranch(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === "Enter") handleTrigger();
                            }}
                            className="h-9 font-mono text-sm"
                            aria-label="Git branch"
                        />
                        <span className="text-xs text-muted-foreground">
                            Branch (defaults to main)
                        </span>
                    </div>
                    <div>
                        <p className="text-xs font-medium text-muted-foreground">
                            Framework
                        </p>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                            {FRAMEWORK_PRESETS.map((preset) => (
                                <Button
                                    key={preset}
                                    size="sm"
                                    variant={
                                        framework === preset
                                            ? "default"
                                            : "outline"
                                    }
                                    className="h-7 px-2.5 font-mono text-xs"
                                    onClick={() => setFramework(preset)}
                                >
                                    {preset}
                                </Button>
                            ))}
                        </div>
                    </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                            Build command (optional)
                        </label>
                        <Input
                            placeholder="e.g. pnpm run build (leave empty for auto)"
                            value={buildCommand}
                            onChange={(e) => setBuildCommand(e.target.value)}
                            className="h-9 font-mono text-sm"
                        />
                    </div>
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-muted-foreground">
                            Output directory (optional)
                        </label>
                        <Input
                            placeholder="e.g. dist (leave empty for auto)"
                            value={outputDir}
                            onChange={(e) => setOutputDir(e.target.value)}
                            className="h-9 font-mono text-sm"
                        />
                    </div>
                </div>
                <p className="text-xs text-muted-foreground">
                    {defaultRepoUrl
                        ? "Rebuilds from the latest commit on the selected branch."
                        : "Paste a public GitHub repo URL. We clone it, run the build, and deploy the output to your project domain."}
                </p>
            </CardContent>
        </Card>
    );
}
