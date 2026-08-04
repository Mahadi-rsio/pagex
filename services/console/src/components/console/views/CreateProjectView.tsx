"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { navigateToProjectOverview } from "@/lib/navigate";
import { apiClient, type BuildDoneEvent } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
    ArrowLeft,
    CheckCircle2,
    Copy,
    Terminal,
    Cloud,
    Code2,
    Workflow,
    KeyRound,
    Loader2,
} from "lucide-react";
import { toast } from "sonner";

const API_KEY_PLACEHOLDER = "YOUR_API_KEY";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
);

function getDeployCommand(projectName: string, apiKey: string) {
    return `npm i evolo && npx evolo deploy --project=${projectName} --source=dist --api-key=${apiKey}`;
}

function getWorkflowCode(projectName: string, apiKey: string) {
    const deploy = getDeployCommand(projectName, apiKey);

    return `name: Deploy to Evolo

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Install & build
        run: |
          npm ci
          npm run build

      - name: Deploy to Evolo
        env:
          EVOLO_API_KEY: \${{ secrets.EVOLO_API_KEY }}
        run: ${deploy.replace(apiKey, "$EVOLO_API_KEY")}
`;
}

function LiveBuildTerminal({
    projectName,
    repoName,
    buildId,
    onComplete,
}: {
    projectName: string;
    repoName: string;
    buildId: string;
    onComplete: () => void;
}) {
    const [lines, setLines] = useState<string[]>([]);
    const [progress, setProgress] = useState(0);
    const [done, setDone] = useState(false);
    const [error, setError] = useState("");
    const bottomRef = useRef<HTMLDivElement>(null);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        const controller = new AbortController();
        apiClient
            .streamBuildLogs(
                buildId,
                {
                    onLog: (message) => setLines((prev) => [...prev, message]),
                    onProgress: (value) => setProgress(value),
                    onDone: (event: BuildDoneEvent) => {
                        setDone(true);
                        if (event.error) {
                            setError(event.error);
                            setLines((prev) => [
                                ...prev,
                                `[error] ${event.error}`,
                            ]);
                        }
                        onCompleteRef.current();
                    },
                    onError: (event) => {
                        setDone(true);
                        setError(event.message);
                        setLines((prev) => [
                            ...prev,
                            `[error] ${event.message}`,
                        ]);
                        onCompleteRef.current();
                    },
                },
                controller.signal,
            )
            .catch(() => {
                setDone(true);
                setError("Failed to connect to the build log stream");
                onCompleteRef.current();
            });
        return () => controller.abort();
    }, [buildId]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    const statusLabel = done
        ? error
            ? "Failed"
            : "Complete"
        : progress > 0
          ? `${Math.round(progress)}%`
          : "Building";

    return (
        <div className="scan-line overflow-hidden rounded-2xl border border-border bg-[#0a0a0a] font-mono text-xs leading-relaxed text-zinc-300 shadow-[0_32px_80px_-32px_oklch(0_0_0/0.75)]">
            <div className="flex items-center justify-between border-b border-white/[0.06] bg-white/[0.03] px-4 py-3">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1.5">
                        <span className="size-2.5 rounded-full bg-zinc-700" />
                        <span className="size-2.5 rounded-full bg-zinc-600" />
                        <span className="size-2.5 rounded-full bg-zinc-500" />
                    </div>
                    <Terminal className="size-4 text-zinc-100" />
                    <span className="font-sans text-sm font-medium text-zinc-100">
                        Build · {projectName}
                    </span>
                </div>
                <Badge
                    variant="outline"
                    className="border-white/10 bg-white/[0.04] font-sans text-xs text-zinc-300"
                >
                    {statusLabel}
                </Badge>
            </div>
            {progress > 0 && !done && (
                <div className="h-1 bg-white/[0.06]">
                    <div
                        className="h-full bg-zinc-100 transition-all"
                        style={{ width: `${progress}%` }}
                    />
                </div>
            )}
            <div className="h-[26rem] space-y-1.5 overflow-y-auto p-5">
                <p className="text-zinc-600">
                    <span className="select-none text-zinc-500">$</span> cloud
                    build {repoName}
                </p>
                {lines.map((line, i) => (
                    <p
                        key={`${i}-${line}`}
                        className={
                            line.startsWith("✓")
                                ? "text-zinc-100"
                                : line.startsWith(">")
                                  ? "text-zinc-300"
                                  : line.startsWith("[error]")
                                    ? "text-red-400"
                                    : "text-zinc-500"
                        }
                    >
                        {line}
                    </p>
                ))}
                {!done && (
                    <span className="inline-block h-3.5 w-2 animate-pulse bg-zinc-100" />
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

function CopyButton({
    value,
    label = "Copy",
}: {
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

function CodeBlock({ code, copyLabel }: { code: string; copyLabel?: string }) {
    return (
        <div className="overflow-hidden rounded-xl border border-border">
            <div className="flex items-center justify-between border-b border-border bg-muted/40 px-3 py-2">
                <span className="text-xs text-muted-foreground">Workflow</span>
                <CopyButton value={code} label={copyLabel ?? "Copy"} />
            </div>
            <pre className="max-h-80 overflow-auto bg-[#0a0a0a] p-4 font-mono text-xs leading-relaxed text-zinc-300">
                <code>{code}</code>
            </pre>
        </div>
    );
}

export function CreateProjectView() {
    const { createProject, isLoading, error, clearError } = useAppStore();
    const router = useRouter();

    const [step, setStep] = useState<"name" | "deploy">("name");
    const [projectName, setProjectName] = useState("");
    const [nameError, setNameError] = useState("");
    const [isCreating, setIsCreating] = useState(false);

    const [repoUrl, setRepoUrl] = useState("");
    const [repoError, setRepoError] = useState("");
    const [isDeploying, setIsDeploying] = useState(false);
    const [showBuild, setShowBuild] = useState(false);
    const [activeBuildId, setActiveBuildId] = useState<string | null>(null);
    const [buildError, setBuildError] = useState("");
    const [createdProjectId, setCreatedProjectId] = useState<string | null>(
        null,
    );

    const slugName = projectName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const deployCommand = getDeployCommand(
        slugName || "project_name",
        API_KEY_PLACEHOLDER,
    );
    const workflowCode = getWorkflowCode(
        slugName || "project_name",
        API_KEY_PLACEHOLDER,
    );

    const handleNameContinue = async () => {
        const name = projectName.trim();
        if (!name) {
            setNameError("Project name is required");
            return;
        }
        if (!/^[a-zA-Z0-9][a-zA-Z0-9-_ ]*$/.test(name)) {
            setNameError(
                "Use letters, numbers, spaces, hyphens, or underscores",
            );
            return;
        }
        setNameError("");
        setIsCreating(true);
        clearError();

        try {
            const project = await createProject({
                name,
                status: "inactive",
                domain: `${slugName}.console.app`,
            });
            setCreatedProjectId(project.id);
            setStep("deploy");
        } catch {
            // Error is already handled by the store
        } finally {
            setIsCreating(false);
        }
    };

    const handleCloudDeploy = async () => {
        const url = repoUrl.trim();
        if (!url) {
            setRepoError("Enter a GitHub repository URL");
            return;
        }
        if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+/.test(url)) {
            setRepoError("Enter a valid public GitHub repository URL");
            return;
        }
        if (!createdProjectId) {
            setRepoError("Project not found — go back and recreate it");
            return;
        }
        if (isDeploying) return;
        setRepoError("");
        setIsDeploying(true);
        setBuildError("");
        setShowBuild(true);
        try {
            const build = await apiClient.triggerBuild({
                pageId: createdProjectId,
                repoUrl: url,
                gitProvider: "github",
                framework: "vite",
                buildCommand: "npm run build",
                outputDir: "dist",
            });
            setActiveBuildId(build.id);
        } catch (buildErr) {
            const message =
                buildErr instanceof Error
                    ? buildErr.message
                    : "Failed to start the build";
            setBuildError(message);
            toast.error(message);
            setIsDeploying(false);
        }
    };

    const handleBuildComplete = () => {
        setIsDeploying(false);
    };

    const handleViewProject = () => {
        if (createdProjectId) {
            navigateToProjectOverview(createdProjectId);
        }
    };

    const handleFinishWithoutRepo = () => {
        if (createdProjectId) {
            navigateToProjectOverview(createdProjectId);
        }
    };

    return (
        <div className="mx-auto max-w-3xl space-y-8 p-6 md:p-8">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => {
                        if (step === "deploy" && !showBuild) {
                            setStep("name");
                        } else if (showBuild && !activeBuildId) {
                            setShowBuild(false);
                            setIsDeploying(false);
                        } else {
                            router.push("/projects");
                        }
                    }}
                    className="size-9 shrink-0"
                >
                    <ArrowLeft className="size-4" />
                </Button>
                <div className="min-w-0 flex-1 space-y-1">
                    <h1 className="text-xl font-bold text-foreground md:text-2xl">
                        Create a new project
                    </h1>
                    <p className="text-sm text-muted-foreground">
                        {step === "name"
                            ? "Choose a name for your project"
                            : "Deploy with Cloud, CLI, or CI/CD"}
                    </p>
                </div>
                {step === "deploy" && (
                    <Badge
                        variant="secondary"
                        className="shrink-0 font-mono text-xs"
                    >
                        {slugName}
                    </Badge>
                )}
            </div>

            {/* Step 1: Project name */}
            {step === "name" && (
                <Card>
                    <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                        <CardTitle className="text-base">
                            Project name
                        </CardTitle>
                        <CardDescription>
                            This name identifies your project across Cloud
                            Deploy, CLI, and CI/CD.
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-5 px-6 pb-6">
                        <div className="space-y-2">
                            <Label htmlFor="project-name">Name</Label>
                            <Input
                                id="project-name"
                                placeholder="my-awesome-project"
                                value={projectName}
                                onChange={(e) => {
                                    setProjectName(e.target.value);
                                    setNameError("");
                                }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter") handleNameContinue();
                                }}
                                className="h-10"
                                autoFocus
                            />
                            {nameError && (
                                <p className="text-xs text-destructive">
                                    {nameError}
                                </p>
                            )}
                            {projectName.trim() && (
                                <p className="text-xs text-muted-foreground">
                                    Slug:{" "}
                                    <span className="font-mono text-foreground">
                                        {slugName}
                                    </span>
                                </p>
                            )}
                        </div>
                        {error && (
                            <p className="text-xs text-destructive">{error}</p>
                        )}
                        <Button
                            onClick={handleNameContinue}
                            className="w-full"
                            size="lg"
                            disabled={isCreating}
                        >
                            {isCreating ? (
                                <>
                                    <Loader2 className="size-4 animate-spin" />
                                    Creating project...
                                </>
                            ) : (
                                "Continue"
                            )}
                        </Button>
                    </CardContent>
                </Card>
            )}

            {/* Step 2: Deploy methods */}
            {step === "deploy" && (
                <Tabs defaultValue="cloud" className="space-y-4">
                    <TabsList className="h-9 w-full">
                        <TabsTrigger value="cloud" className="gap-1.5 px-3">
                            <Cloud className="size-3.5" />
                            Cloud Deploy
                        </TabsTrigger>
                        <TabsTrigger value="cli" className="gap-1.5 px-3">
                            <Code2 className="size-3.5" />
                            CLI
                        </TabsTrigger>
                        <TabsTrigger value="cicd" className="gap-1.5 px-3">
                            <Workflow className="size-3.5" />
                            CI/CD
                        </TabsTrigger>
                    </TabsList>

                    {/* Cloud Deploy */}
                    <TabsContent value="cloud" className="space-y-4">
                        {showBuild ? (
                            <Card>
                                <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                                    <CardTitle className="flex items-center gap-2 text-base">
                                        {activeBuildId && !isDeploying ? (
                                            <CheckCircle2 className="size-4 text-foreground" />
                                        ) : (
                                            <Loader2 className="size-4 animate-spin text-foreground" />
                                        )}
                                        {activeBuildId && !isDeploying
                                            ? "Deployment complete"
                                            : "Building your project"}
                                    </CardTitle>
                                    <CardDescription>
                                        {repoUrl.trim()} · GitHub
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 px-6 pb-6">
                                    {buildError && !activeBuildId ? (
                                        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                                            {buildError}
                                        </div>
                                    ) : activeBuildId ? (
                                        <LiveBuildTerminal
                                            projectName={slugName}
                                            repoName={repoUrl.trim()}
                                            buildId={activeBuildId}
                                            onComplete={handleBuildComplete}
                                        />
                                    ) : (
                                        <div className="flex h-64 items-center justify-center rounded-xl border border-border bg-[#0a0a0a]">
                                            <div className="flex items-center gap-2 text-zinc-500">
                                                <Loader2 className="size-4 animate-spin" />
                                                Starting build…
                                            </div>
                                        </div>
                                    )}
                                    {!isDeploying && activeBuildId && (
                                        <Button
                                            onClick={handleViewProject}
                                            className="w-full"
                                            size="lg"
                                        >
                                            View project
                                        </Button>
                                    )}
                                </CardContent>
                            </Card>
                        ) : (
                            <Card>
                                <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                                    <CardTitle className="text-base">
                                        Deploy from GitHub
                                    </CardTitle>
                                    <CardDescription>
                                        Build and deploy a public GitHub
                                        repository with one click. No account
                                        connection required.
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
                                                    if (e.key === "Enter")
                                                        handleCloudDeploy();
                                                }}
                                                className="h-10 pr-24 font-mono text-sm"
                                            />
                                            <Button
                                                className="absolute right-1 top-1/2 h-8 -translate-y-1/2 gap-1.5 px-3"
                                                onClick={handleCloudDeploy}
                                                disabled={isDeploying}
                                            >
                                                <Cloud className="size-3.5" />
                                                Deploy
                                            </Button>
                                        </div>
                                    </div>
                                    {repoError && (
                                        <p className="text-xs text-destructive">
                                            {repoError}
                                        </p>
                                    )}
                                    <p className="text-xs text-muted-foreground">
                                        Paste a public GitHub repo URL. We clone
                                        it, run the build, and deploy the output
                                        to your project domain.
                                    </p>
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    {/* CLI */}
                    <TabsContent value="cli">
                        <Card>
                            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                                <CardTitle className="text-base">
                                    Deploy with the Evolo CLI
                                </CardTitle>
                                <CardDescription>
                                    Install the CLI locally and deploy{" "}
                                    <span className="font-mono">
                                        {slugName}
                                    </span>{" "}
                                    from your terminal.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5 px-6 pb-6">
                                {[
                                    {
                                        step: "1",
                                        title: "Log in",
                                        description:
                                            "Authenticate the CLI with your Evolo account.",
                                        command: "evolo login",
                                    },
                                    {
                                        step: "2",
                                        title: "Initialize",
                                        description:
                                            "Link this folder to your project.",
                                        command: "evolo init",
                                    },
                                    {
                                        step: "3",
                                        title: "Deploy",
                                        description:
                                            "Build and ship your app to production.",
                                        command: "evolo deploy",
                                    },
                                ].map((item) => (
                                    <div
                                        key={item.step}
                                        className="space-y-2 rounded-xl border border-border p-4"
                                    >
                                        <div className="flex items-start gap-3">
                                            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                                                {item.step}
                                            </span>
                                            <div className="min-w-0 flex-1 space-y-1">
                                                <p className="text-sm font-medium text-foreground">
                                                    {item.title}
                                                </p>
                                                <p className="text-xs text-muted-foreground">
                                                    {item.description}
                                                </p>
                                            </div>
                                            <CopyButton value={item.command} />
                                        </div>
                                        <pre className="overflow-x-auto rounded-lg bg-[#0a0a0a] px-3 py-2.5 font-mono text-xs text-zinc-300">
                                            <code>$ {item.command}</code>
                                        </pre>
                                    </div>
                                ))}

                                <div className="rounded-xl border border-border bg-muted/30 p-4">
                                    <p className="mb-2 text-xs font-medium text-foreground">
                                        Tip
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        Run these commands from your project
                                        root after building locally. When
                                        you&apos;re done, open the project in
                                        the console.
                                    </p>
                                </div>

                                <Button
                                    onClick={handleFinishWithoutRepo}
                                    variant="outline"
                                    className="w-full"
                                    size="lg"
                                >
                                    Continue to project
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    {/* CI/CD */}
                    <TabsContent value="cicd">
                        <Card>
                            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                                <CardTitle className="text-base">
                                    Deploy with CI/CD
                                </CardTitle>
                                <CardDescription>
                                    Add a workflow that runs{" "}
                                    <span className="font-mono text-[11px]">
                                        npx evolo deploy
                                    </span>{" "}
                                    on every push.
                                </CardDescription>
                            </CardHeader>
                            <CardContent className="space-y-5 px-6 pb-6">
                                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="space-y-1">
                                        <p className="text-sm font-medium text-foreground">
                                            API key
                                        </p>
                                        <p className="text-xs text-muted-foreground">
                                            Replace{" "}
                                            <code className="font-mono">
                                                {API_KEY_PLACEHOLDER}
                                            </code>{" "}
                                            with your Evolo API key.
                                        </p>
                                    </div>
                                </div>

                                <div className="rounded-xl border border-border bg-muted/30 p-3">
                                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                                        <KeyRound className="size-3.5" />
                                        Deploy action
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                                            {deployCommand}
                                        </code>
                                        <CopyButton
                                            value={deployCommand}
                                            label="Copy"
                                        />
                                    </div>
                                </div>

                                <CodeBlock code={workflowCode} />

                                <p className="text-xs text-muted-foreground">
                                    Store your API key as{" "}
                                    <code className="font-mono">
                                        EVOLO_API_KEY
                                    </code>{" "}
                                    in your GitHub Actions secrets, then paste
                                    the workflow into your repo.
                                </p>

                                <Button
                                    onClick={handleFinishWithoutRepo}
                                    variant="outline"
                                    className="w-full"
                                    size="lg"
                                >
                                    Continue to project
                                </Button>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
