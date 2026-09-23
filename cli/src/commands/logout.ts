import type { CommandModule } from "yargs";
import { clearToken } from "../utils/session.js";
import { logger } from "../utils/logger.js";
import { clearJwtCache } from "../utils/jwt.js";

export const logoutCmd: CommandModule = {
    command: "logout",
    describe: "Log out and clear saved session",
    handler: () => {
        clearToken();
        clearJwtCache()

        logger.success("Logged out successfully. Run `pagex login` to authenticate again.");
    },
};
