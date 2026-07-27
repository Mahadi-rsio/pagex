import { ProjectOverviewClient } from "./ProjectOverviewClient";

export function generateStaticParams() {
    return [{ projectId: "_" }];
}

export default function ProjectOverviewPage() {
    return <ProjectOverviewClient />;
}
