"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAppStore } from "@/store/useAppStore";
import { navigateToProjectOverview } from "@/lib/navigate";
import { apiClient } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Cloud, Code2, Workflow } from "lucide-react";
import { toast } from "sonner";
import {
    API_KEY_PLACEHOLDER,
    getDeployCommand,
    getWorkflowCode,
} from "./create-project/deploy-snippets";
import { ProjectNameStep } from "./create-project/ProjectNameStep";
import { CloudDeployPanel } from "./create-project/CloudDeployPanel";
import { CliDeployPanel } from "./create-project/CliDeployPanel";
import { CicdDeployPanel } from "./create-project/CicdDeployPanel";

export function CreateProjectView() {
    const { createProject, error, clearError } = useAppStore();
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

            {step === "name" && (
                <ProjectNameStep
                    projectName={projectName}
                    slugName={slugName}
                    nameError={nameError}
                    storeError={error}
                    isCreating={isCreating}
                    onProjectNameChange={(value) => {
                        setProjectName(value);
                        setNameError("");
                    }}
                    onContinue={handleNameContinue}
                />
            )}

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

                    <TabsContent value="cloud" className="space-y-4">
                        <CloudDeployPanel
                            showBuild={showBuild}
                            slugName={slugName}
                            repoUrl={repoUrl}
                            repoError={repoError}
                            buildError={buildError}
                            activeBuildId={activeBuildId}
                            isDeploying={isDeploying}
                            onRepoUrlChange={(value) => {
                                setRepoUrl(value);
                                setRepoError("");
                            }}
                            onDeploy={handleCloudDeploy}
                            onBuildComplete={handleBuildComplete}
                            onViewProject={handleViewProject}
                        />
                    </TabsContent>

                    <TabsContent value="cli">
                        <CliDeployPanel
                            slugName={slugName}
                            onContinue={handleFinishWithoutRepo}
                        />
                    </TabsContent>

                    <TabsContent value="cicd">
                        <CicdDeployPanel
                            deployCommand={deployCommand}
                            workflowCode={workflowCode}
                            onContinue={handleFinishWithoutRepo}
                        />
                    </TabsContent>
                </Tabs>
            )}
        </div>
    );
}
