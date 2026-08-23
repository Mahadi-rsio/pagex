"use client";

import type { TreeViewElement } from "@/components/ui/file-tree";
import type { ApiBuild } from "@/lib/api-client";
import {
    CheckCircle2,
    AlertCircle,
    Loader2,
    Clock,
} from "lucide-react";

export const buildStatusConfig: Record<
    ApiBuild["status"],
    {
        label: string;
        variant: "default" | "secondary" | "destructive" | "outline";
    }
> = {
    queued: { label: "Queued", variant: "secondary" },
    active: { label: "Building", variant: "secondary" },
    completed: { label: "Completed", variant: "default" },
    failed: { label: "Failed", variant: "destructive" },
};

export const CNAME_TARGET = "cname.console.app";

export function pathsToTreeElements(paths: string[]): TreeViewElement[] {
    type MutableNode = TreeViewElement & { children?: MutableNode[] };
    const root: MutableNode[] = [];
    const folders = new Map<string, MutableNode>();

    for (const rawPath of paths) {
        const normalized = rawPath.replace(/^\/+/, "");
        const parts = normalized.split("/").filter(Boolean);
        if (parts.length === 0) continue;

        let siblings = root;
        let currentPath = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i]!;
            const isFile = i === parts.length - 1;
            currentPath = currentPath ? `${currentPath}/${part}` : part;

            if (isFile) {
                siblings.push({
                    id: currentPath,
                    name: part,
                    type: "file",
                    isSelectable: true,
                });
                continue;
            }

            let folder = folders.get(currentPath);
            if (!folder) {
                folder = {
                    id: currentPath,
                    name: part,
                    type: "folder",
                    isSelectable: true,
                    children: [],
                };
                folders.set(currentPath, folder);
                siblings.push(folder);
            }
            siblings = folder.children!;
        }
    }

    return root;
}

export function topLevelExpandedIds(elements: TreeViewElement[]): string[] {
    return elements
        .filter((el) => el.type === "folder" || Array.isArray(el.children))
        .map((el) => el.id);
}

export function formatBytes(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
    if (bytes < 1024 ** 3) return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    return `${(bytes / 1024 ** 3).toFixed(3)} GB`;
}

export const statusConfig = {
    active: {
        label: "Active",
        icon: CheckCircle2,
        color: "text-foreground",
        badgeVariant: "default" as const,
    },
    building: {
        label: "Building",
        icon: Loader2,
        color: "text-muted-foreground",
        badgeVariant: "secondary" as const,
    },
    error: {
        label: "Error",
        icon: AlertCircle,
        color: "text-destructive",
        badgeVariant: "destructive" as const,
    },
    inactive: {
        label: "Inactive",
        icon: Clock,
        color: "text-muted-foreground",
        badgeVariant: "outline" as const,
    },
};

export function parseEnvVars(text: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) continue;
        const key = trimmed.slice(0, eq).trim();
        const value = trimmed.slice(eq + 1).trim();
        if (key) result[key] = value;
    }
    return result;
}

export function parseGithubRepo(repoUrl: string): { owner: string; repo: string } | null {
    const match = repoUrl
        .trim()
        .match(/github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i);
    if (!match) return null;
    return { owner: match[1]!, repo: match[2]! };
}

export type LatestCommitInfo = {
    sha: string;
    shortSha: string;
    message: string;
    author: string;
    date: string;
    url: string;
};

export async function fetchLatestGithubCommit(
    repoUrl: string,
): Promise<LatestCommitInfo | null> {
    const parsed = parseGithubRepo(repoUrl);
    if (!parsed) return null;
    try {
        const res = await fetch(
            `https://api.github.com/repos/${parsed.owner}/${parsed.repo}/commits?per_page=1`,
            { headers: { Accept: "application/vnd.github+json" } },
        );
        if (!res.ok) return null;
        const data = (await res.json()) as Array<{
            sha: string;
            html_url: string;
            commit: {
                message: string;
                author?: { name?: string; date?: string };
            };
            author?: { login?: string };
        }>;
        const commit = data[0];
        if (!commit) return null;
        return {
            sha: commit.sha,
            shortSha: commit.sha.slice(0, 7),
            message: commit.commit.message.split("\n")[0] || "No message",
            author:
                commit.commit.author?.name ||
                commit.author?.login ||
                "unknown",
            date: commit.commit.author?.date || "",
            url: commit.html_url,
        };
    } catch {
        return null;
    }
}
