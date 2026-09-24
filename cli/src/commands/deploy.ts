import fs from "fs";
import path from "path";
import type { CommandModule } from "yargs";
import { checkStatus } from "../utils/session.js";
import { deploy } from "../utils/deployHandler.js";
import { runBuild } from "../utils/buildHandler.js";
import { config } from "../config.js";
import { handleError, ConfigError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

interface PagexConfig {
    id?: string;
    project_name?: string;
    domain?: string;
}

interface DeployArgs {
    build: boolean;
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
        }),
    handler: async (argv) => {
        const { build } = argv as unknown as DeployArgs;
        try {
            const session = await checkStatus();
            const cwd = process.cwd();

            logger.step(1, `Authenticated as ${session.session?.name ?? "you"}`);

            if (build) {
                await runBuild(cwd);
            }

            const { pageId, projectName, domain } = resolveTarget(cwd);
            logger.step(2, `Deploying to ${projectName}`);
            await deploy("./", pageId, domain);
            logger.hintCommand("pagex deploy", "deploy a new version:");
        } catch (err) {
            handleError(err);
        }
    },
};
