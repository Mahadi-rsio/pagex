import type { CommandModule } from "yargs";
import { loginCmd } from "./login.js";
import { logoutCmd } from "./logout.js";
import { initCmd } from "./initProject.js";
import { statusCmd } from "./status.js";
import { deployCmd } from "./deploy.js";
import { listCmd } from "./list.js";

/**
 * Central command registry.
 * Add new commands here — the entry point registers all of them automatically.
 */
export const commands: CommandModule[] = [
    loginCmd,
    logoutCmd,
    initCmd,
    statusCmd,
    deployCmd,
    listCmd,

];
