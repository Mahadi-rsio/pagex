import { create } from "zustand";
import { apiClient } from "@/lib/api-client";
import {
    mapApiPagesToProjects,
    mapProjectToCreatePageInput,
} from "@/lib/api-mappers";
import type { ApiPage } from "@/lib/api-client";

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
    isLoading: boolean;
    error: string | null;
    setUser: (user: User | null) => void;
    setTheme: (theme: "light" | "dark") => void;
    addProject: (
        project: Omit<Project, "id" | "createdAt" | "updatedAt">,
    ) => Project;
    deleteProject: (id: string) => Promise<void>;
    getProject: (id: string) => Project | undefined;
    fetchProjects: () => Promise<void>;
    createProject: (
        project: Omit<Project, "id" | "createdAt" | "updatedAt">,
    ) => Promise<Project>;
    clearError: () => void;
}

// Initial state with empty arrays for real data
const initialActivities: Activity[] = [];
const initialProjects: Project[] = [];

export const useAppStore = create<AppStore>((set, get) => ({
    user: null,
    balance: 0,
    theme: "dark",
    projects: initialProjects,
    activities: initialActivities,
    isLoading: false,
    error: null,

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

    clearError: () => set({ error: null }),

    fetchProjects: async () => {
        try {
            set({ isLoading: true, error: null });
            const apiPages = await apiClient.getPages();
            const projects = mapApiPagesToProjects(apiPages);
            set({ projects, isLoading: false });
        } catch (error) {
            set({
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to fetch projects",
                isLoading: false,
            });
            console.error("Failed to fetch projects:", error);
        }
    },

    createProject: async (projectData) => {
        try {
            set({ isLoading: true, error: null });

            // Map console project to API input
            const apiInput = mapProjectToCreatePageInput(projectData);

            // Create project via API
            const apiPage = await apiClient.createPage(apiInput);

            // Map back to console project
            const project: Project = {
                ...projectData,
                id: apiPage.id,
                domain: apiPage.domain,
                createdAt: apiPage.createdAt,
                updatedAt: apiPage.updatedAt ?? apiPage.createdAt,
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
                isLoading: false,
            }));

            return project;
        } catch (error) {
            set({
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to create project",
                isLoading: false,
            });
            console.error("Failed to create project:", error);
            throw error;
        }
    },

    deleteProject: async (id) => {
        try {
            set({ isLoading: true, error: null });
            await apiClient.deletePage(id);
            set((state) => ({
                projects: state.projects.filter((p) => p.id !== id),
                isLoading: false,
            }));
        } catch (error) {
            set({
                error:
                    error instanceof Error
                        ? error.message
                        : "Failed to delete project",
                isLoading: false,
            });
            console.error("Failed to delete project:", error);
            throw error;
        }
    },

    getProject: (id) => {
        return get().projects.find((p) => p.id === id);
    },

    // Legacy method for backward compatibility
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
}));
