"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { navigateToProjectOverview } from "@/lib/navigate";
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
    Search,
    ArrowLeft,
    GitBranch,
    Clock,
    CheckCircle2,
    Copy,
    Terminal,
    Cloud,
    Code2,
    Workflow,
    KeyRound,
    Loader2,
} from "lucide-react";

const MOCK_API_KEY = "evo_sk_live_8f3a2c91d4e7b6a0";

const GithubIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
    </svg>
);

const GitlabIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M23.955 13.587l-1.342-4.135-2.664-8.189c-.135-.423-.73-.423-.867 0L16.418 9.45H7.582L4.919 1.263C4.783.84 4.185.84 4.05 1.26L1.386 9.449.044 13.587c-.121.375.014.789.331 1.023L12 23.054l11.625-8.443c.318-.235.453-.648.33-1.024" />
    </svg>
);

const BitbucketIcon = (props: React.SVGProps<SVGSVGElement>) => (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" {...props}>
        <path d="M.778 1.213a.768.768 0 00-.768.892l3.263 19.81c.084.5.515.868 1.022.873H19.95a.772.772 0 00.77-.646l3.27-20.03a.768.768 0 00-.768-.891zM14.52 15.53H9.522L8.17 8.466h7.561z" />
    </svg>
);

type Provider = "github" | "gitlab" | "bitbucket";

interface MockRepo {
    id: string;
    name: string;
    fullName: string;
    description?: string;
    updatedAt: string;
    isPrivate: boolean;
}

const mockRepos: Record<Provider, MockRepo[]> = {
    github: [
        {
            id: "r1",
            name: "my-next-app",
            fullName: "acme/my-next-app",
            description: "Next.js SaaS application",
            updatedAt: "2026-07-16T07:00:00Z",
            isPrivate: false,
        },
        {
            id: "r2",
            name: "api-backend",
            fullName: "acme/api-backend",
            description: "REST API with Node.js",
            updatedAt: "2026-07-15T12:00:00Z",
            isPrivate: true,
        },
        {
            id: "r3",
            name: "marketing-site",
            fullName: "acme/marketing-site",
            description: "Landing page",
            updatedAt: "2026-07-14T09:00:00Z",
            isPrivate: false,
        },
        {
            id: "r4",
            name: "mobile-app",
            fullName: "acme/mobile-app",
            description: "React Native app",
            updatedAt: "2026-07-12T15:00:00Z",
            isPrivate: true,
        },
    ],
    gitlab: [
        {
            id: "g1",
            name: "devops-pipeline",
            fullName: "acme/devops-pipeline",
            description: "CI/CD pipeline configs",
            updatedAt: "2026-07-15T08:00:00Z",
            isPrivate: true,
        },
        {
            id: "g2",
            name: "data-processor",
            fullName: "acme/data-processor",
            description: "ETL data processing",
            updatedAt: "2026-07-13T14:00:00Z",
            isPrivate: true,
        },
    ],
    bitbucket: [
        {
            id: "b1",
            name: "legacy-api",
            fullName: "acme/legacy-api",
            description: "Old REST API",
            updatedAt: "2026-07-10T10:00:00Z",
            isPrivate: true,
        },
        {
            id: "b2",
            name: "frontend-v1",
            fullName: "acme/frontend-v1",
            description: "Old frontend",
            updatedAt: "2026-07-08T09:00:00Z",
            isPrivate: false,
        },
    ],
};

const providerConfig = {
    github: {
        label: "GitHub",
        icon: GithubIcon,
        color: "hover:border-foreground/40 hover:bg-muted/50",
        activeColor: "border-foreground/50 bg-muted text-foreground",
    },
    gitlab: {
        label: "GitLab",
        icon: GitlabIcon,
        color: "hover:border-orange-500/50 hover:bg-orange-500/5",
        activeColor:
            "border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-400",
    },
    bitbucket: {
        label: "Bitbucket",
        icon: BitbucketIcon,
        color: "hover:border-blue-500/50 hover:bg-blue-500/5",
        activeColor:
            "border-blue-500 bg-blue-500/10 text-blue-600 dark:text-blue-400",
    },
};

function getDeployCommand(projectName: string, apiKey: string) {
    return `npm i evolo && npx evolo deploy --project=${projectName} --source=dist --api-key=${apiKey}`;
}

function getWorkflowCode(
    provider: Provider,
    projectName: string,
    apiKey: string,
) {
    const deploy = getDeployCommand(projectName, apiKey);

    if (provider === "github") {
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

    if (provider === "gitlab") {
        return `stages:
  - build
  - deploy

build:
  stage: build
  image: node:20
  script:
    - npm ci
    - npm run build
  artifacts:
    paths:
      - dist/

deploy:
  stage: deploy
  image: node:20
  script:
    - ${deploy.replace(apiKey, "$EVOLO_API_KEY")}
  only:
    - main
`;
    }

    return `image: node:20

pipelines:
  branches:
    main:
      - step:
          name: Build & Deploy to Evolo
          caches:
            - node
          script:
            - npm ci
            - npm run build
            - ${deploy.replace(apiKey, "$EVOLO_API_KEY")}
`;
}

const BUILD_LOG_LINES = [
    { text: "> Cloning repository...", delay: 400 },
    { text: "> Installing dependencies...", delay: 900 },
    { text: "  npm ci", delay: 1400 },
    { text: "  added 482 packages in 8.2s", delay: 2000 },
    { text: "> Building application...", delay: 2600 },
    { text: "  vite build", delay: 3100 },
    { text: "  ✓ 124 modules transformed.", delay: 3700 },
    { text: "  dist/index.html                   0.46 kB", delay: 4100 },
    { text: "  dist/assets/index-a1b2c3d4.js   142.18 kB", delay: 4500 },
    { text: "> Uploading build artifacts...", delay: 5100 },
    { text: "> Provisioning edge network...", delay: 5700 },
    { text: "✓ Build completed successfully", delay: 6300 },
    { text: "✓ Deployed to production", delay: 6800 },
];

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
                    <CheckCircle2 className="size-3.5 text-emerald-500" />
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
            <pre className="max-h-80 overflow-auto bg-[#0d1117] p-4 text-xs leading-relaxed text-slate-300">
                <code>{code}</code>
            </pre>
        </div>
    );
}

function BuildTerminal({
    projectName,
    repoName,
    onComplete,
}: {
    projectName: string;
    repoName: string;
    onComplete: () => void;
}) {
    const [lines, setLines] = useState<string[]>([]);
    const [done, setDone] = useState(false);
    const bottomRef = useRef<HTMLDivElement>(null);
    const onCompleteRef = useRef(onComplete);
    onCompleteRef.current = onComplete;

    useEffect(() => {
        const timers = BUILD_LOG_LINES.map(({ text, delay }) =>
            window.setTimeout(() => {
                setLines((prev) => [...prev, text]);
            }, delay),
        );

        const doneTimer = window.setTimeout(() => {
            setDone(true);
            onCompleteRef.current();
        }, 7200);

        return () => {
            timers.forEach(clearTimeout);
            clearTimeout(doneTimer);
        };
    }, []);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }, [lines]);

    return (
        <div className="overflow-hidden rounded-xl border border-[#2d3139] bg-[#0d1117] font-mono text-xs text-slate-300 shadow-lg">
            <div className="flex items-center justify-between border-b border-[#2d3139] bg-[#21262d] px-4 py-2.5">
                <div className="flex items-center gap-2 text-slate-200">
                    <Terminal className="size-4 text-[#ec7211]" />
                    <span className="font-sans text-sm font-medium">
                        Build · {projectName}
                    </span>
                </div>
                <Badge
                    variant="outline"
                    className="border-[#30363d] bg-[#161b22] font-sans text-xs text-slate-300"
                >
                    {done ? "Complete" : "Building"}
                </Badge>
            </div>
            <div className="h-64 space-y-1 overflow-y-auto p-4">
                <p className="text-slate-500">
                    $ evolo deploy --project={projectName} --repo={repoName}
                </p>
                {lines.map((line, i) => (
                    <p
                        key={`${i}-${line}`}
                        className={
                            line.startsWith("✓")
                                ? "text-emerald-400"
                                : line.startsWith(">")
                                  ? "text-[#79c0ff]"
                                  : "text-slate-400"
                        }
                    >
                        {line}
                    </p>
                ))}
                {!done && (
                    <span className="inline-block h-3.5 w-1.5 animate-pulse bg-slate-300" />
                )}
                <div ref={bottomRef} />
            </div>
        </div>
    );
}

export function CreateProjectView() {
    const { addProject } = useAppStore();
    const router = useRouter();

    const [step, setStep] = useState<"name" | "deploy">("name");
    const [projectName, setProjectName] = useState("");
    const [nameError, setNameError] = useState("");

    const [provider, setProvider] = useState<Provider>("github");
    const [searchQuery, setSearchQuery] = useState("");
    const [selectedRepo, setSelectedRepo] = useState<MockRepo | null>(null);
    const [isDeploying, setIsDeploying] = useState(false);
    const [showBuild, setShowBuild] = useState(false);
    const [createdProjectId, setCreatedProjectId] = useState<string | null>(
        null,
    );

    const [ciProvider, setCiProvider] = useState<Provider>("github");

    const repos = mockRepos[provider];
    const filteredRepos = repos.filter(
        (repo) =>
            repo.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            repo.description?.toLowerCase().includes(searchQuery.toLowerCase()),
    );

    const slugName = projectName
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
    const deployCommand = getDeployCommand(
        slugName || "project_name",
        MOCK_API_KEY,
    );
    const workflowCode = getWorkflowCode(
        ciProvider,
        slugName || "project_name",
        MOCK_API_KEY,
    );

    const handleNameContinue = () => {
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
        setStep("deploy");
    };

    const handleCloudDeploy = () => {
        if (!selectedRepo || isDeploying) return;
        setIsDeploying(true);
        setShowBuild(true);

        const project = addProject({
            name: projectName.trim(),
            description: selectedRepo.description,
            repo: selectedRepo.fullName,
            provider,
            status: "building",
            domain: `${slugName}.console.app`,
        });
        setCreatedProjectId(project.id);
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
        const project = addProject({
            name: projectName.trim(),
            status: "inactive",
            domain: `${slugName}.console.app`,
        });
        navigateToProjectOverview(project.id);
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
                        <Button
                            onClick={handleNameContinue}
                            className="w-full"
                            size="lg"
                        >
                            Continue
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
                                        {isDeploying ? (
                                            <Loader2 className="size-4 animate-spin text-blue-500" />
                                        ) : (
                                            <CheckCircle2 className="size-4 text-emerald-500" />
                                        )}
                                        {isDeploying
                                            ? "Building your project"
                                            : "Deployment complete"}
                                    </CardTitle>
                                    <CardDescription>
                                        {selectedRepo?.fullName} ·{" "}
                                        {providerConfig[provider].label}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-4 px-6 pb-6">
                                    <BuildTerminal
                                        projectName={slugName}
                                        repoName={selectedRepo?.fullName ?? ""}
                                        onComplete={handleBuildComplete}
                                    />
                                    {!isDeploying && (
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
                                        Connect a repository
                                    </CardTitle>
                                    <CardDescription>
                                        Import from GitHub, GitLab, or Bitbucket
                                        to deploy from the cloud.
                                    </CardDescription>
                                </CardHeader>
                                <CardContent className="space-y-5 px-6 pb-6">
                                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                                        {(
                                            Object.keys(
                                                providerConfig,
                                            ) as Provider[]
                                        ).map((p) => {
                                            const {
                                                label,
                                                icon: Icon,
                                                color,
                                                activeColor,
                                            } = providerConfig[p];
                                            const isActive = provider === p;
                                            return (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() => {
                                                        setProvider(p);
                                                        setSelectedRepo(null);
                                                        setSearchQuery("");
                                                    }}
                                                    className={`flex items-center justify-center gap-2.5 rounded-xl border-2 px-4 py-4 text-sm font-medium transition-all ${
                                                        isActive
                                                            ? activeColor
                                                            : `border-border text-muted-foreground ${color}`
                                                    }`}
                                                >
                                                    <Icon className="size-5 shrink-0" />
                                                    <span>{label}</span>
                                                    {isActive && (
                                                        <CheckCircle2 className="ml-auto size-3.5 shrink-0" />
                                                    )}
                                                </button>
                                            );
                                        })}
                                    </div>

                                    <div className="relative">
                                        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                                        <Input
                                            placeholder="Search repositories..."
                                            value={searchQuery}
                                            onChange={(e) =>
                                                setSearchQuery(e.target.value)
                                            }
                                            className="h-10 pl-9"
                                        />
                                    </div>

                                    <div className="max-h-72 space-y-2.5 overflow-y-auto pr-1">
                                        {filteredRepos.length === 0 ? (
                                            <div className="py-10 text-center text-sm text-muted-foreground">
                                                No repositories found
                                            </div>
                                        ) : (
                                            filteredRepos.map((repo) => (
                                                <button
                                                    key={repo.id}
                                                    type="button"
                                                    onClick={() =>
                                                        setSelectedRepo(repo)
                                                    }
                                                    className={`flex w-full items-center gap-3.5 rounded-xl border p-4 text-left transition-all ${
                                                        selectedRepo?.id ===
                                                        repo.id
                                                            ? "border-primary bg-primary/5"
                                                            : "border-border hover:border-primary/30 hover:bg-accent/50"
                                                    }`}
                                                >
                                                    <div className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                                                        <GitBranch className="size-4 text-muted-foreground" />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2">
                                                            <span className="truncate text-sm font-medium text-foreground">
                                                                {repo.name}
                                                            </span>
                                                            {repo.isPrivate && (
                                                                <Badge
                                                                    variant="outline"
                                                                    className="shrink-0 py-0 text-xs"
                                                                >
                                                                    Private
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        {repo.description && (
                                                            <p className="mt-1 truncate text-xs text-muted-foreground">
                                                                {
                                                                    repo.description
                                                                }
                                                            </p>
                                                        )}
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                                                        <Clock className="size-3" />
                                                        {new Date(
                                                            repo.updatedAt,
                                                        ).toLocaleDateString()}
                                                    </div>
                                                </button>
                                            ))
                                        )}
                                    </div>

                                    <Button
                                        onClick={handleCloudDeploy}
                                        disabled={!selectedRepo}
                                        className="w-full gap-2"
                                        size="lg"
                                    >
                                        <Cloud className="size-4" />
                                        Deploy
                                    </Button>
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
                                        <pre className="overflow-x-auto rounded-lg bg-[#0d1117] px-3 py-2.5 font-mono text-xs text-emerald-400">
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
                                        <p className="font-mono text-xs text-muted-foreground">
                                            {MOCK_API_KEY.slice(0, 16)}••••••••
                                        </p>
                                    </div>
                                    <CopyButton
                                        value={MOCK_API_KEY}
                                        label="Copy API key"
                                    />
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

                                <div className="space-y-3">
                                    <p className="text-sm font-medium text-foreground">
                                        Workflow provider
                                    </p>
                                    <div className="grid grid-cols-3 gap-2">
                                        {(
                                            Object.keys(
                                                providerConfig,
                                            ) as Provider[]
                                        ).map((p) => {
                                            const { label, icon: Icon } =
                                                providerConfig[p];
                                            const isActive = ciProvider === p;
                                            return (
                                                <button
                                                    key={p}
                                                    type="button"
                                                    onClick={() =>
                                                        setCiProvider(p)
                                                    }
                                                    className={`flex items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-xs font-medium transition-all ${
                                                        isActive
                                                            ? "border-primary bg-primary/5 text-foreground"
                                                            : "border-border text-muted-foreground hover:bg-accent"
                                                    }`}
                                                >
                                                    <Icon className="size-4 shrink-0" />
                                                    <span className="hidden sm:inline">
                                                        {label}
                                                    </span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                <CodeBlock code={workflowCode} />

                                <p className="text-xs text-muted-foreground">
                                    Store your API key as{" "}
                                    <code className="font-mono">
                                        EVOLO_API_KEY
                                    </code>{" "}
                                    in your provider secrets, then paste the
                                    workflow into your repo.
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
