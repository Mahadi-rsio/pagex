import type { CommandModule } from "yargs";
import { listPages } from "../api/projectApi.js";
import { logger } from "../utils/logger.js";
import { handleError } from "../utils/errors.js";

export const listCmd: CommandModule = {
    command: "pages",
    describe: "List all projects associated with your account",
    handler: async () => {
        try {
            const spinner = logger.spinner("Fetching projects...").start();
            const projects = await listPages();
            spinner.stop();

            if (projects.length === 0) {
                logger.info("No projects found. Run `pagex init` and `pagex deploy` to create one.");
                return;
            }

            logger.info(`\nFound ${projects.length} project(s):\n`);
            for (const project of projects) {
                logger.info(`  • ${project.project_name}  [${project.domain}]`);
            }
        } catch (err) {
            handleError(err);
        }
    },
};
