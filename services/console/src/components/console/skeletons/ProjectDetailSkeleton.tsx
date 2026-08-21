"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function ProjectDetailSkeleton() {
    return (
        <div className="p-6 space-y-6 animate-in fade-in-50">
            <div className="flex items-center gap-3">
                <Skeleton className="size-10 rounded-none" />
                <div className="space-y-2">
                    <Skeleton className="h-6 w-48" />
                    <Skeleton className="h-4 w-64" />
                </div>
            </div>

            <div className="flex gap-2 border-b border-border pb-2">
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
                <Skeleton className="h-8 w-24" />
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <Card className="lg:col-span-2">
                    <CardContent className="p-6 space-y-4">
                        <Skeleton className="h-6 w-36" />
                        <Skeleton className="h-24 w-full rounded-none" />
                        <Skeleton className="h-32 w-full rounded-none" />
                    </CardContent>
                </Card>
                <Card>
                    <CardContent className="p-6 space-y-4">
                        <Skeleton className="h-6 w-28" />
                        <Skeleton className="h-4 w-full" />
                        <Skeleton className="h-4 w-3/4" />
                        <Skeleton className="h-4 w-1/2" />
                    </CardContent>
                </Card>
            </div>
        </div>
    );
}
