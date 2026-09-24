import type { CommandModule } from "yargs";
import chalk from "chalk";
import { listPages, type Pages } from "../api/projectApi.js";
import { logger } from "../utils/logger.js";
import { handleError } from "../utils/errors.js";

function renderTable(projects: Pages[]): string {
    const nameWidth = Math.max(
        ...projects.map((p) => p.project_name.length),
        "Project".length,
    );

    const header =
        chalk.bold(chalk.green("Project".padEnd(nameWidth))) +
        "  " +
        chalk.bold(chalk.green("Domain".padEnd(28 - nameWidth)));

    const rows = projects.map((p) => {
        const name = p.project_name.padEnd(nameWidth);
        const domain = p.domain.padEnd(28 - nameWidth);
        return `${name}  ${domain}`;
    });

    return [header, ...rows].join("\n");
}

export const listCmd: CommandModule = {
    command: "pages",
    describe: "List the projects on your account",
    handler: async () => {
        try {
            const spinner = logger.spinner("Fetching projects…").start();
            let projects: Pages[];
            try {
                projects = await listPages();
            } finally {
                spinner.stop();
            }

            if (projects.length === 0) {
                logger.warn("No projects yet.");
                logger.hintCommand("pagex init");
                return;
            }

            logger.bold(`\n  ${projects.length} project${projects.length === 1 ? "" : "s"} on your account\n`);
            for (const line of renderTable(projects).split("\n")) {
                logger.info(`  ${line}`);
            }
            logger.hintCommand("pagex init", "\nlink a project to this directory:");
        } catch (err) {
            handleError(err);
        }
    },
};
