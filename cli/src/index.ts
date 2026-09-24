#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { commands } from "./commands/index.js";
import { setLogLevel } from "./utils/logger.js";
import { handleError } from "./utils/errors.js";
import { createRequire } from "module";

// Read version from package.json at runtime
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

process.on("SIGINT", () => {
    console.log(chalk.dim("\n✖ Interrupted — no changes were completed.\n"));
    process.exit(130);
});

process.on("unhandledRejection", (reason) => {
    handleError(reason instanceof Error ? reason : new Error(String(reason)));
});

const cli = yargs(hideBin(process.argv))
    .scriptName("pagex")
    .usage(chalk.bold("$0 <command> [options]"))
    .version(pkg.version)
    .alias("v", "version")
    .help()
    .alias("h", "help")
    .option("quiet", {
        type: "boolean",
        describe: "Suppress all output except errors",
        global: true,
        default: false,
    })
    .option("verbose", {
        type: "boolean",
        describe: "Enable verbose/debug output",
        global: true,
        default: false,
    })
    .middleware((argv) => {
        if (argv["quiet"]) setLogLevel("silent");
        else if (argv["verbose"]) setLogLevel("verbose");
    })
    .demandCommand(1, chalk.yellow("Please specify a command."))
    .strict()
    .fail((msg, err, instance) => {
        if (err) {
            handleError(err);
        }
        if (msg) {
            console.error(chalk.red(`\n${msg}\n`));
            if (instance && "showHelp" in instance) {
                (instance as unknown as { showHelp: (level: "log") => void }).showHelp("log");
            }
        }
        process.exit(1);
    })
    .epilogue(
        [
            chalk.dim("\nRun "),
            chalk.green("pagex <command> --help"),
            chalk.dim(" for details on any command."),
            chalk.dim("\nDocs: "),
            chalk.green("https://pagex.cloud"),
        ].join(""),
    );

// Register all commands from the registry
for (const cmd of commands) {
    cli.command(cmd);
}

cli.parse();
