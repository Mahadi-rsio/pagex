"use client";

import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { CopyButton } from "./CopyButton";

const CLI_STEPS = [
    {
        step: "1",
        title: "Log in",
        description: "Authenticate the CLI with your Evolo account.",
        command: "evolo login",
    },
    {
        step: "2",
        title: "Initialize",
        description: "Link this folder to your project.",
        command: "evolo init",
    },
    {
        step: "3",
        title: "Deploy",
        description: "Build and ship your app to production.",
        command: "evolo deploy",
    },
] as const;

type CliDeployPanelProps = {
    slugName: string;
    onContinue: () => void;
};

export function CliDeployPanel({ slugName, onContinue }: CliDeployPanelProps) {
    return (
        <Card>
            <CardHeader className="space-y-1.5 px-6 pt-6 pb-4">
                <CardTitle className="text-base">
                    Deploy with the Evolo CLI
                </CardTitle>
                <CardDescription>
                    Install the CLI locally and deploy{" "}
                    <span className="font-mono">{slugName}</span> from your
                    terminal.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5 px-6 pb-6">
                {CLI_STEPS.map((item) => (
                    <div
                        key={item.step}
                        className="space-y-2 rounded-none border border-border p-4"
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
                        <pre className="overflow-x-auto rounded-none bg-[#0a0a0a] px-3 py-2.5 font-mono text-xs text-zinc-300">
                            <code>$ {item.command}</code>
                        </pre>
                    </div>
                ))}

                <div className="rounded-none border border-border bg-muted/30 p-4">
                    <p className="mb-2 text-xs font-medium text-foreground">
                        Tip
                    </p>
                    <p className="text-xs text-muted-foreground">
                        Run these commands from your project root after building
                        locally. When you&apos;re done, open the project in the
                        console.
                    </p>
                </div>

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
