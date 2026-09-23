import type { CommandModule } from "yargs";
import { authClient } from "../auth/deviceAuth.js";
import { getToken } from "../utils/session.js";
import { logger } from "../utils/logger.js";
import { handleError, AuthError } from "../utils/errors.js";

async function statusCommand() {
    const spinner = logger.spinner("Checking account status...").start();

    const { data: sessionData, error: sessionError } = await authClient.getSession({
        fetchOptions: {
            headers: { Authorization: `Bearer ${getToken()}` },
        },
    });

    const { data: jwtData, error: jwtError } = await authClient.token({
        fetchOptions: {
            headers: { Authorization: `Bearer ${getToken()}` },
        },
    });

    spinner.stop();

    if (sessionError || jwtError || !sessionData) {
        throw new AuthError("Could not retrieve session. Please run `pagex login`.");
    }

    logger.success(`Logged in as ${sessionData.user.name} (${sessionData.user.email})`);
    logger.verbose(`Token: ${jwtData?.token ?? "(unavailable)"}`);
}

export const statusCmd: CommandModule = {
    command: "status",
    describe: "Check your account login status",
    handler: async () => {
        try {
            await statusCommand();
        } catch (err) {
            handleError(err);
        }
    },
};
