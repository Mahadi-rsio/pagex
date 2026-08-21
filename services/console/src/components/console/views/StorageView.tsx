"use client";

import {
    Card,
    CardContent,
    CardHeader,
    CardTitle,
    CardDescription,
} from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { HardDrive } from "lucide-react";

export function StorageView() {
    const used = 0;
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
                        <div className="size-10 rounded-none bg-muted flex items-center justify-center">
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
                    <p className="text-sm text-muted-foreground py-2 text-center">
                        No storage usage yet.
                    </p>
                </CardContent>
            </Card>
        </div>
    );
}
