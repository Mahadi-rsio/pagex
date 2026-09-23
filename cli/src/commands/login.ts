import type { CommandModule } from "yargs";
import { deviceLogin } from "../auth/deviceAuth.js";
import { saveToken } from "../utils/session.js";
import { logger } from "../utils/logger.js";
import { handleError } from "../utils/errors.js";

async function loginCommand() {
    try {
        const token = await deviceLogin();
        saveToken(token);
        logger.success("Login successful!");
    } catch (err) {
        handleError(err);
    }
}

export const loginCmd: CommandModule = {
    command: "login",
    describe: "Login to your PageX account",
    handler: async () => {
        await loginCommand();
    },
};
