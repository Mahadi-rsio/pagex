import type { CommandModule } from "yargs";
import { authClient } from "../auth/deviceAuth.js";
import { getToken } from "../utils/session.js";
import { logger } from "../utils/logger.js";
import { handleError, AuthError } from "../utils/errors.js";

async function statusCommand() {
    const token = getToken();

    if (!token) {
        logger.warn("You are not logged in.");
        logger.hintCommand("pagex login");
        return;
    }

    const spinner = logger.spinner("Checking account status…").start();

    try {
        const { data: sessionData, error: sessionError } = await authClient.getSession({
            fetchOptions: {
                headers: { Authorization: `Bearer ${token}` },
            },
        });

        const { data: jwtData } = await authClient.token({
            fetchOptions: {
                headers: { Authorization: `Bearer ${token}` },
            },
        });

        if (sessionError || !sessionData) {
            throw new AuthError("Could not retrieve your session. Please run `pagex login`.");
        }

        logger.success(`Logged in as ${sessionData.user.name} (${sessionData.user.email})`);
        logger.hintCommand("pagex deploy");
        logger.verbose(`Token: ${jwtData?.token ?? "(unavailable)"}`);
    } finally {
        spinner.stop();
    }
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
