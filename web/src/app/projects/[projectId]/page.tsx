import { ProjectRedirectClient } from "./ProjectRedirectClient";

export function generateStaticParams() {
    return [{ projectId: "_" }];
}

export default function ProjectPageRedirect() {
    return <ProjectRedirectClient />;
}
