import fs from "fs";
import path from "path";
import type { CommandModule } from "yargs";
import prompts from "prompts";
import { detectFramework } from "../utils/frameworkDetector.js";
import { logger } from "../utils/logger.js";
import { handleError, ConfigError } from "../utils/errors.js";
import { apiClient } from "../api/client.js";
import { authClient } from "../auth/deviceAuth.js";
import { getToken } from "../utils/session.js";
import { listPages, type Pages } from "../api/projectApi.js";
import { config } from "../config.js";

interface CreateProjectResponse {
    id: string;
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

interface InitArgs {
    name?: string | undefined;
    link?: string | undefined;
}

interface PagexConfig {
    id: string;
    project_name: string;
    domain: string;
    framework: string;
    created_at: string;
}

async function detectFrameworkName(cwd: string): Promise<string> {
    const detected = await detectFramework(cwd);
    const frameworks = Object.values(detected).flat();
    return frameworks[0] ?? "unknown";
}

function writeLinkFile(cwd: string, value: PagexConfig): string {
    const configPath = path.join(cwd, config.CONFIG_FILE);
    fs.writeFileSync(configPath, JSON.stringify(value, null, 2));
    return configPath;
}

/** Append the link file to .gitignore (idempotent). */
function ignoreLinkFile(cwd: string): void {
    const gitIgnorePath = path.join(cwd, ".gitignore");
    const existingContent = fs.existsSync(gitIgnorePath)
        ? fs.readFileSync(gitIgnorePath, "utf-8")
        : "";
    if (existingContent.split(/\r?\n/).includes(config.CONFIG_FILE)) return;

    const prefix =
        existingContent.length > 0 && !existingContent.endsWith("\n") ? "\n" : "";
    fs.appendFileSync(gitIgnorePath, `${prefix}${config.CONFIG_FILE}\n`);
}

async function ensureLoggedIn(): Promise<void> {
    const { error } = await authClient.getSession({
        fetchOptions: {
            headers: { Authorization: `Bearer ${getToken()}` },
        },
    });

    if (error) {
        throw new ConfigError("You are not logged in. Please run `pagex login`.");
    }
}

async function createProject(cwd: string, projectName: string): Promise<void> {
    const framework = await detectFrameworkName(cwd);

    logger.info("Creating project...");
    // POST /api/pages/create — body is { project_name } only; tenant comes from JWT
    const { data } = await apiClient.post<CreateProjectResponse>(
        "/api/pages/create",
        { project_name: projectName },
    );

    const linkFile: PagexConfig = {
        id: data.id,
        project_name: data.project_name,
        domain: data.domain,
        framework,
        created_at: data.createdAt,
    };

    const configPath = writeLinkFile(cwd, linkFile);
    ignoreLinkFile(cwd);

    logger.success(`Project "${data.project_name}" created successfully`);
    logger.success(`Domain: ${data.domain}`);
    logger.success(".gitignore file updated");
    logger.verbose(`Config created at ${configPath}`);
}

async function linkProject(cwd: string, target?: string): Promise<void> {
    logger.info("Fetching your projects...");
    const projects: Pages[] = await listPages();

    if (!projects || projects.length === 0) {
        logger.warn(
            "No existing projects found. Create one with: pagex init → Create a new project",
        );
        return;
    }

    let selected: Pages | undefined;

    if (target) {
        selected = projects.find(
            (p) => p.id === target || p.project_name === target,
        );
        if (!selected) {
            throw new ConfigError(
                `No project matching "${target}". Run \`pagex pages\` to list projects.`,
            );
        }
    } else {
        const { selectedProject } = await prompts({
            type: "select",
            name: "selectedProject",
            message: "Select a project to link",
            choices: projects.map((p) => ({
                title: `${p.project_name}  (${p.domain})`,
                value: p,
            })),
        });

        if (!selectedProject) {
            logger.warn("Linking cancelled.");
            return;
        }
        selected = selectedProject as Pages;
    }

    const framework = await detectFrameworkName(cwd);

    const linkFile: PagexConfig = {
        id: selected.id,
        project_name: selected.project_name,
        domain: selected.domain,
        framework,
        created_at: selected.createdAt,
    };

    const configPath = writeLinkFile(cwd, linkFile);
    ignoreLinkFile(cwd);

    logger.success(`Linked to project "${selected.project_name}"`);
    logger.success(`Domain: ${selected.domain}`);
    logger.verbose(`Config written at ${configPath}`);
}

async function initProject(args: InitArgs): Promise<void> {
    const cwd = process.cwd();

    // --- Non-interactive: create ---
    if (args.name) {
        await ensureLoggedIn();
        await createProject(cwd, args.name);
        return;
    }

    // --- Non-interactive: link ---
    if (args.link) {
        await ensureLoggedIn();
        await linkProject(cwd, args.link);
        return;
    }

    // --- Interactive ---
    const files = fs.readdirSync(cwd);
    if (files.length === 0) {
        logger.warn("Directory is empty. Create a new project first.");
        return;
    }

    const { mode } = await prompts({
        type: "select",
        name: "mode",
        message: "How would you like to set up this project?",
        choices: [
            { title: "Create a new project", value: "new" },
            { title: "Link an existing project", value: "existing" },
        ],
    });

    if (!mode) {
        logger.warn("Initialization cancelled.");
        return;
    }

    if (mode === "existing") {
        await ensureLoggedIn();
        await linkProject(cwd);
        return;
    }

    const detected = await detectFramework(cwd);
    const frameworks = Object.values(detected).flat();
    if (frameworks.length === 0) {
        throw new ConfigError("No supported framework detected in this project.");
    }

    const response = await prompts([
        {
            type: "text",
            name: "projectName",
            message: "Enter your project name",
            validate: (v: string) =>
                v.trim().length === 0 ? "Project name cannot be empty" : true,
        },
    ]);

    if (!response.projectName) {
        logger.warn("Initialization cancelled.");
        return;
    }

    await ensureLoggedIn();
    await createProject(cwd, response.projectName as string);
}

export const initCmd: CommandModule = {
    command: "init",
    describe: "Initialize a project for deployment",
    builder: (yargs) =>
        yargs
            .option("name", {
                type: "string",
                describe: "Create a new project with this name (non-interactive)",
            })
            .option("link", {
                type: "string",
                describe: "Link an existing project by name or id (non-interactive)",
            }),
    handler: async (argv) => {
        const { name, link } = argv as unknown as InitArgs;
        try {
            await initProject({ name, link });
        } catch (err) {
            handleError(err);
        }
    },
};
