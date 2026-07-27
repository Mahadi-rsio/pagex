"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive, Database, Folder } from "lucide-react";

export function StorageView() {
    const used = 2.4;
    const limit = 10;

    return (
        <div className="p-6 space-y-6 max-w-4xl">
            <div>
                <h1 className="text-xl font-bold text-foreground">
                    Storage Management
                </h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                    Overview of your stored artifacts, media, and database
                    objects.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <div className="flex items-center gap-3">
                        <div className="size-10 rounded-lg bg-muted flex items-center justify-center">
                            <HardDrive className="size-5 text-foreground" />
                        </div>
                        <div>
                            <CardTitle className="text-base">
                                Storage Usage
                            </CardTitle>
                            <CardDescription>
                                {used} GB of {limit} GB used
                            </CardDescription>
                        </div>
                    </div>
                </CardHeader>
                <CardContent className="space-y-4">
                    <Progress value={(used / limit) * 100} className="h-2" />
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 pt-2">
                        <div className="p-3 rounded-lg bg-muted/40 border border-border">
                            <div className="flex items-center gap-2 mb-1">
                                <Folder className="size-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                    Build Artifacts
                                </span>
                            </div>
                            <p className="text-lg font-bold text-foreground">
                                1.8 GB
                            </p>
                        </div>
                        <div className="p-3 rounded-lg bg-muted/40 border border-border">
                            <div className="flex items-center gap-2 mb-1">
                                <Database className="size-4 text-muted-foreground" />
                                <span className="text-xs text-muted-foreground">
                                    Database Logs
                                </span>
                            </div>
                            <p className="text-lg font-bold text-foreground">
                                600 MB
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
}
