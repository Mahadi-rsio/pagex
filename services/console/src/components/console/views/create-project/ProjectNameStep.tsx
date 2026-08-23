"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";

type ProjectNameStepProps = {
    projectName: string;
    slugName: string;
    nameError: string;
    storeError: string | null;
    isCreating: boolean;
    onProjectNameChange: (value: string) => void;
    onContinue: () => void;
};

export function ProjectNameStep({
    projectName,
    slugName,
    nameError,
    storeError,
    isCreating,
    onProjectNameChange,
    onContinue,
}: ProjectNameStepProps) {
    return (
        <Card>
            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                <CardTitle className="text-base">Project name</CardTitle>
                <CardDescription>
                    This name identifies your project across Cloud Deploy, CLI,
                    and CI/CD.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
                <div className="space-y-2">
                    <Label htmlFor="project-name">Name</Label>
                    <Input
                        id="project-name"
                        placeholder="my-awesome-project"
                        value={projectName}
                        onChange={(e) => onProjectNameChange(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter") onContinue();
                        }}
                        className="h-10"
                        autoFocus
                    />
                    {nameError && (
                        <p className="text-xs text-destructive">{nameError}</p>
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
                {storeError && (
                    <p className="text-xs text-destructive">{storeError}</p>
                )}
                <Button
                    onClick={onContinue}
                    className="w-full"
                    size="lg"
                    disabled={isCreating}
                >
                    {isCreating ? (
                        <>
                            <Spinner size="inline" />
                            Creating project...
                        </>
                    ) : (
                        "Continue"
                    )}
                </Button>
            </CardContent>
        </Card>
    );
}
