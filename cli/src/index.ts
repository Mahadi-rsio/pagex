#!/usr/bin/env node

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import chalk from "chalk";
import { commands } from "./commands/index.js";
import { setLogLevel } from "./utils/logger.js";
import { createRequire } from "module";

// Read version from package.json at runtime
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

process.on("SIGINT", () => {
    console.log(chalk.red("\n[Process Terminated]"));
    process.exit(0);
});

const cli = yargs(hideBin(process.argv))
    .scriptName("pagex")
    .usage("$0 <command> [options]")
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
    .demandCommand(1, chalk.red("Please specify a command."))
    .strict();

// Register all commands from the registry
for (const cmd of commands) {
    cli.command(cmd);
}

cli.parse();
