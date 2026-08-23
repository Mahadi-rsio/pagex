"use client";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { KeyRound } from "lucide-react";
import { API_KEY_PLACEHOLDER } from "./deploy-snippets";
import { CopyButton } from "./CopyButton";
import { CodeBlock } from "./CodeBlock";

type CicdDeployPanelProps = {
    deployCommand: string;
    workflowCode: string;
    onContinue: () => void;
};

export function CicdDeployPanel({
    deployCommand,
    workflowCode,
    onContinue,
}: CicdDeployPanelProps) {
    return (
        <Card>
            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                <CardTitle className="text-base">Deploy with CI/CD</CardTitle>
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

                <div className="rounded-none border border-border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center gap-2 text-xs text-muted-foreground">
                        <KeyRound className="size-3.5" />
                        Deploy action
                    </div>
                    <div className="flex items-start gap-2">
                        <code className="min-w-0 flex-1 break-all font-mono text-xs text-foreground">
                            {deployCommand}
                        </code>
                        <CopyButton value={deployCommand} label="Copy" />
                    </div>
                </div>

                <CodeBlock code={workflowCode} />

                <p className="text-xs text-muted-foreground">
                    Store your API key as{" "}
                    <code className="font-mono">EVOLO_API_KEY</code> in your
                    GitHub Actions secrets, then paste the workflow into your
                    repo.
                </p>

                <Button
                    onClick={onContinue}
                    variant="outline"
                    className="w-full"
                    size="lg"
                >
                    Continue to project
                </Button>
            </CardContent>
        </Card>
    );
}
