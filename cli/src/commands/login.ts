import type { CommandModule } from "yargs";
import { deviceLogin } from "../auth/deviceAuth.js";
import { logger } from "../utils/logger.js";
import { handleError } from "../utils/errors.js";

async function loginCommand() {
    try {
        await deviceLogin();
        logger.hintCommand("pagex deploy");
    } catch (err) {
        handleError(err);
    }
}

export const loginCmd: CommandModule = {
    command: "login",
    describe: "Authenticate with your PageX account",
    handler: async () => {
        await loginCommand();
    },
};
