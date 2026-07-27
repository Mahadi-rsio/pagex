"use client";

import { Suspense, lazy } from "react";
import { DashboardSkeleton } from "@/components/console/skeletons/DashboardSkeleton";
import { ProjectsSkeleton } from "@/components/console/skeletons/ProjectsSkeleton";
import { ProjectDetailSkeleton } from "@/components/console/skeletons/ProjectDetailSkeleton";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardView = lazy(() =>
    import("@/components/console/views/DashboardView").then((mod) => ({
        default: mod.DashboardView,
    })),
);

const ProjectsView = lazy(() =>
    import("@/components/console/views/ProjectsView").then((mod) => ({
        default: mod.ProjectsView,
    })),
);

const CreateProjectView = lazy(() =>
    import("@/components/console/views/CreateProjectView").then((mod) => ({
        default: mod.CreateProjectView,
    })),
);

const ProjectDetailView = lazy(() =>
    import("@/components/console/views/ProjectDetailView").then((mod) => ({
        default: mod.ProjectDetailView,
    })),
);

const SettingsView = lazy(() =>
    import("@/components/console/views/SettingsView").then((mod) => ({
        default: mod.SettingsView,
    })),
);

const BillingView = lazy(() =>
    import("@/components/console/views/BillingView").then((mod) => ({
        default: mod.BillingView,
    })),
);

const StorageView = lazy(() =>
    import("@/components/console/views/StorageView").then((mod) => ({
        default: mod.StorageView,
    })),
);

function PageFallback() {
    return (
        <div className="space-y-4 p-6">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-48 w-full" />
        </div>
    );
}

export function LazyDashboardPage() {
    return (
        <Suspense fallback={<DashboardSkeleton />}>
            <DashboardView />
        </Suspense>
    );
}

export function LazyProjectsPage() {
    return (
        <Suspense fallback={<ProjectsSkeleton />}>
            <ProjectsView />
        </Suspense>
    );
}

export function LazyCreateProjectPage() {
    return (
        <Suspense fallback={<ProjectsSkeleton />}>
            <CreateProjectView />
        </Suspense>
    );
}

export function LazyProjectDetailPage({ projectId }: { projectId: string }) {
    return (
        <Suspense fallback={<ProjectDetailSkeleton />}>
            <ProjectDetailView projectId={projectId} />
        </Suspense>
    );
}

export function LazySettingsPage() {
    return (
        <Suspense fallback={<PageFallback />}>
            <SettingsView />
        </Suspense>
    );
}

export function LazyBillingPage() {
    return (
        <Suspense fallback={<PageFallback />}>
            <BillingView />
        </Suspense>
    );
}

export function LazyStoragePage() {
    return (
        <Suspense fallback={<PageFallback />}>
            <StorageView />
        </Suspense>
    );
}
