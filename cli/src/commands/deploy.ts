import fs from "fs";
import path from "path";
import type { CommandModule } from "yargs";
import { checkStatus } from "../utils/session.js";
import { deploy } from "../utils/deployHandler.js";
import { runBuild } from "../utils/buildHandler.js";
import { config } from "../config.js";
import { handleError, ConfigError } from "../utils/errors.js";

interface PagexConfig {
    id?: string;
    project_name?: string;
}

interface DeployArgs {
    build: boolean;
}

function resolvePageId(cwd: string): string {
    const cfgPath = path.join(cwd, config.CONFIG_FILE);
    if (!fs.existsSync(cfgPath)) {
        throw new ConfigError(
            `No ${config.CONFIG_FILE} found. Run \`pagex init\` to create or link a project.`,
        );
    }

    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8")) as PagexConfig;
    const pageId = cfg.id ?? cfg.project_name;
    if (!pageId) {
        throw new ConfigError(
            `${config.CONFIG_FILE} is missing id and project_name. Run \`pagex init\` again.`,
        );
    }
    return pageId;
}

export const deployCmd: CommandModule = {
    command: "deploy",
    describe:
        "Deploy an existing build to the cloud (uploads originals; server optimizes assets at commit)",
    builder: (yargs) =>
        yargs.option("build", {
            type: "boolean",
            default: false,
            describe: "Run the project's build script before deploying",
        }),
    handler: async (argv) => {
        const { build } = argv as unknown as DeployArgs;
        try {
            await checkStatus();
            const cwd = process.cwd();

            if (build) {
                await runBuild(cwd);
            }

            const pageId = resolvePageId(cwd);
            await deploy("./", pageId);
        } catch (err) {
            handleError(err);
        }
    },
};
