import type { CommandModule } from "yargs";
import { clearToken } from "../utils/session.js";
import { logger } from "../utils/logger.js";
import { clearJwtCache } from "../utils/jwt.js";

export const logoutCmd: CommandModule = {
    command: "logout",
    describe: "Log out and clear the saved session",
    handler: () => {
        const hadSession = clearToken();
        clearJwtCache();

        if (hadSession) {
            logger.success("Logged out successfully.");
        } else {
            logger.warn("No active session to clear.");
        }
        logger.hintCommand("pagex login");
    },
};
