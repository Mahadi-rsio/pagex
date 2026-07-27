"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";

export function ProjectsSkeleton() {
    return (
        <div className="p-6 space-y-6 animate-in fade-in-50">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="space-y-1">
                    <Skeleton className="h-8 w-40" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <Skeleton className="h-9 w-32" />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {[1, 2, 3, 4, 5, 6].map((i) => (
                    <Card key={i} className="p-4 space-y-4">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <Skeleton className="size-10 rounded-lg" />
                                <div className="space-y-1.5">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="h-3 w-20" />
                                </div>
                            </div>
                            <Skeleton className="h-5 w-16 rounded-full" />
                        </div>
                        <Skeleton className="h-3 w-full" />
                        <Skeleton className="h-3 w-4/5" />
                        <div className="pt-2 flex justify-between items-center border-t border-border/50">
                            <Skeleton className="h-3 w-24" />
                            <Skeleton className="h-3 w-16" />
                        </div>
                    </Card>
                ))}
            </div>
        </div>
    );
}
