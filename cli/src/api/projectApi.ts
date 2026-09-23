import { apiClient } from "./client.js";


export interface Pages {
    id: string;
    tenant_id: string;
    tenant_name: string;
    plan: string;
    domain: string;
    project_name: string;
    request: number;
    request_limit: number;
    bandwidth_usage: number;
    bandwidth_limit: number;
    createdAt: string;
}


export interface EnvVar {
    key: string;
    value: string;
}

export interface DeploymentLog {
    timestamp: string;
    message: string;
    level: "info" | "warn" | "error";
}

/**
 * List all projects belonging to the authenticated user.
 */
export async function listPages(): Promise<Pages[]> {
    const response = await apiClient.get<Pages[]>("/api/pages");
    return response.data;
}

