import fs from "fs";
import path from "path";
import type { CommandModule } from "yargs";
import { checkStatus } from "../utils/session.js";
import { deploy } from "../utils/deployHandler.js";
import { runBuild } from "../utils/buildHandler.js";
import { config } from "../config.js";
import { setAuthTokenOverride } from "../api/client.js";
import { handleError, ConfigError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface PagexConfig {
    id?: string;
    project_name?: string;
    domain?: string;
}

interface DeployArgs {
    build: boolean;
    project?: string;
    token?: string;
    dir?: string;
    json: boolean;
}

interface ResolvedTarget {
    pageId: string;
    projectName: string;
    domain?: string;
}

function resolveTarget(cwd: string): ResolvedTarget {
    const cfgPath = path.join(cwd, config.CONFIG_FILE);
    if (!fs.existsSync(cfgPath)) {
        throw new ConfigError(
            `No ${config.CONFIG_FILE} found here. Run \`pagex init\` to create or link a project.`,
        );
    }

    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as PagexConfig;
    const pageId = cfg.id ?? cfg.project_name;
    if (!pageId) {
        throw new ConfigError(
            `${config.CONFIG_FILE} is missing id and project_name. Run \`pagex init\` again.`,
        );
    }

    const target: ResolvedTarget = { pageId, projectName: cfg.project_name ?? pageId };
    if (cfg.domain) target.domain = cfg.domain;
    return target;
}

/** Emit a machine-readable result line (build-machine mode). */
function emitResult(payload: Record<string, unknown>): void {
    // A single prefixed line is easy for the runner to parse without
    // interfering with spinner/logger output.
    process.stdout.write(`\nPAGEX_RESULT ${JSON.stringify(payload)}\n`);
}

export const deployCmd: CommandModule = {
    command: "deploy",
    describe:
        "Deploy an existing build to the cloud (uploads originals; server optimizes assets at commit)",
    builder: (yargs) =>
        yargs.options({
            build: {
                alias: "b",
                type: "boolean" as const,
                default: false,
                describe: "Run the project's build script before deploying",
            },
            project: {
                type: "string" as const,
                describe:
                    "Target project name or id (build-machine mode; skips pagex.json)",
            },
            token: {
                type: "string" as const,
                describe:
                    "Build job token for non-interactive machine deploys (skips login)",
            },
            dir: {
                type: "string" as const,
                describe:
                    "Explicit build output directory (build-machine mode)",
            },
            json: {
                type: "boolean" as const,
                default: false,
                describe: "Print a machine-readable result line on success",
            },
        }),
    handler: async (argv) => {
        const { build, project, dir, json } = argv as unknown as DeployArgs;
        // The job token is preferred via env (PAGEX_JOB_TOKEN) so it never
        // appears in the process argument list; --token still works for manual
        // debugging.
        const token = (argv as unknown as DeployArgs).token ?? process.env.PAGEX_JOB_TOKEN;
        try {
            const cwd = process.cwd();

            let pageId: string;
            let projectName: string;
            let domain: string | undefined;

            if (token) {
                // Build-machine mode: the job token authenticates the request
                // and is scoped server-side to the build's project. No local
                // session and no pagex.json are required.
                setAuthTokenOverride(token);
                if (!project) {
                    throw new ConfigError(
                        "`--project` is required when deploying with --token",
                    );
                }
                pageId = project;
                projectName = project;
            } else {
                const session = await checkStatus();
                logger.step(
                    1,
                    `Authenticated as ${session.session?.name ?? "you"}`,
                );
                const target = resolveTarget(cwd);
                pageId = target.pageId;
                projectName = target.projectName;
                domain = target.domain;
            }

            if (build) {
                await runBuild(cwd);
            }

            if (!token) {
                logger.step(2, `Deploying to ${projectName}`);
            }

            const result = await deploy("./", pageId, domain, dir);

            if (json) {
                emitResult({
                    success: true,
                    project: projectName,
                    deploymentId: result.deploymentId ?? null,
                    version: result.version ?? null,
                    url: result.url ?? null,
                });
            }

            if (!token) {
                logger.hintCommand("pagex deploy", "deploy a new version:");
            }
        } catch (err) {
            if (json) {
                const message = err instanceof Error ? err.message : String(err);
                emitResult({ success: false, error: message });
            }
            handleError(err);
        }
    },
};
