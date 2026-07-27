import { create } from "zustand";

export interface Project {
    id: string;
    name: string;
    description?: string;
    repo?: string;
    provider?: "github" | "gitlab" | "bitbucket";
    status: "active" | "building" | "error" | "inactive";
    createdAt: string;
    updatedAt: string;
    domain?: string;
}

export interface User {
    id: string;
    name: string;
    email: string;
    avatarUrl?: string;
}

export interface Activity {
    id: string;
    type: "deploy" | "build" | "error" | "create" | "delete";
    message: string;
    projectId?: string;
    projectName?: string;
    timestamp: string;
}

interface AppStore {
    user: User | null;
    balance: number;
    theme: "light" | "dark";
    projects: Project[];
    activities: Activity[];
    setUser: (user: User | null) => void;
    setTheme: (theme: "light" | "dark") => void;
    addProject: (
        project: Omit<Project, "id" | "createdAt" | "updatedAt">,
    ) => Project;
    deleteProject: (id: string) => void;
    getProject: (id: string) => Project | undefined;
}

const mockActivities: Activity[] = [
    {
        id: "1",
        type: "deploy",
        message: "Deployed to production",
        projectName: "my-saas-app",
        projectId: "proj-1",
        timestamp: "2026-07-16T07:50:00Z",
    },
    {
        id: "2",
        type: "build",
        message: "Build completed successfully",
        projectName: "landing-page",
        projectId: "proj-2",
        timestamp: "2026-07-16T06:30:00Z",
    },
    {
        id: "3",
        type: "create",
        message: "Project created",
        projectName: "api-service",
        projectId: "proj-3",
        timestamp: "2026-07-15T20:00:00Z",
    },
    {
        id: "4",
        type: "error",
        message: "Build failed: dependency conflict",
        projectName: "my-saas-app",
        projectId: "proj-1",
        timestamp: "2026-07-15T15:00:00Z",
    },
    {
        id: "5",
        type: "deploy",
        message: "Deployed to staging",
        projectName: "landing-page",
        projectId: "proj-2",
        timestamp: "2026-07-15T12:00:00Z",
    },
];

const mockProjects: Project[] = [
    {
        id: "proj-1",
        name: "my-saas-app",
        description: "Main SaaS application",
        repo: "acme/my-saas-app",
        provider: "github",
        status: "active",
        domain: "my-saas-app.vercel.app",
        createdAt: "2026-07-01T00:00:00Z",
        updatedAt: "2026-07-16T07:50:00Z",
    },
    {
        id: "proj-2",
        name: "landing-page",
        description: "Marketing landing page",
        repo: "acme/landing-page",
        provider: "github",
        status: "building",
        domain: "acme.com",
        createdAt: "2026-07-05T00:00:00Z",
        updatedAt: "2026-07-16T06:30:00Z",
    },
    {
        id: "proj-3",
        name: "api-service",
        description: "Backend API service",
        repo: "acme/api-service",
        provider: "gitlab",
        status: "active",
        domain: "api.acme.com",
        createdAt: "2026-07-10T00:00:00Z",
        updatedAt: "2026-07-15T20:00:00Z",
    },
];

export const useAppStore = create<AppStore>((set, get) => ({
    user: null,
    balance: 47.5,
    theme: "dark",
    projects: mockProjects,
    activities: mockActivities,

    setUser: (user) => set({ user }),

    setTheme: (theme) => {
        set({ theme });
        if (typeof document !== "undefined") {
            const root = document.documentElement;
            root.classList.toggle("dark", theme === "dark");
            root.style.colorScheme = theme;
            window.localStorage.setItem("theme", theme);
        }
    },

    addProject: (projectData) => {
        const project: Project = {
            ...projectData,
            id: `proj-${Math.random().toString(36).substring(2, 9)}`,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
        };
        set((state) => ({
            projects: [project, ...state.projects],
            activities: [
                {
                    id: Math.random().toString(36).substring(2, 9),
                    type: "create",
                    message: "Project created",
                    projectId: project.id,
                    projectName: project.name,
                    timestamp: new Date().toISOString(),
                },
                ...state.activities,
            ],
        }));
        return project;
    },

    deleteProject: (id) => {
        set((state) => ({
            projects: state.projects.filter((p) => p.id !== id),
        }));
    },

    getProject: (id) => {
        return get().projects.find((p) => p.id === id);
    },
}));
