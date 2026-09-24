import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import open from "open";
import chalk from "chalk";
import { saveToken } from "../utils/session.js";
import { jwtClient } from "better-auth/client/plugins";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";
import { AuthError } from "../utils/errors.js";

export const authClient = createAuthClient({
    baseURL: config.AUTH_BASE_URL,
    plugins: [
        deviceAuthorizationClient(),
        jwtClient(),
    ],
});

function formatUserCode(code: string): string {
    const clean = code.replace(/\s+/g, "").toUpperCase();
    return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

/** Give up waiting for the user to authorize after this long so the CLI never hangs. */
const MAX_POLL_MS = 15 * 60 * 1000;

export async function deviceLogin(): Promise<string> {
    const spinner = logger.spinner("Requesting device authorization…").start();

    const { data, error } = await authClient.device.code({
        client_id: config.CLIENT_ID,
        scope: "openid profile email",
    });

    if (error || !data) {
        spinner.fail("Failed to start authorization");
        throw new AuthError(
            error?.error_description ?? "The auth server did not return a verification code.",
        );
    }

    spinner.succeed("Authorization started");

    const {
        device_code,
        user_code,
        verification_uri,
        verification_uri_complete,
        interval = 5,
    } = data;

    // The server builds verification URLs from its own baseURL (e.g. the
    // internal console address). Point the browser at the URL the user
    // actually configured via PAGEX_AUTH_URL.
    const publicUrl = toPublicAuthUrl(verification_uri_complete || verification_uri);

    console.log("");
    console.log(chalk.bold(chalk.yellow("  1. Enter this code on the authorization page:")));
    console.log(chalk.bgYellow(chalk.black(`  ${formatUserCode(user_code)}  `)));
    console.log("");
    console.log(chalk.bold(chalk.yellow("  2. Then visit (opening your browser automatically):")));
    console.log(chalk.cyan(`    ${publicUrl}`));
    console.log("");

    await open(publicUrl).catch(() => {
        logger.hint(`Unable to open a browser automatically — open the URL above manually.`);
    });

    return pollForToken(device_code, interval);
}

/** Swap the origin of a verification URL for the configured auth base URL. */
function toPublicAuthUrl(url: string): string {
    try {
        const target = new URL(url);
        const base = new URL(config.AUTH_BASE_URL);
        target.protocol = base.protocol;
        target.host = base.host;
        return target.toString();
    } catch {
        return url;
    }
}

async function pollForToken(deviceCode: string, interval: number): Promise<string> {
    const spinner = logger.spinner("Waiting for authorization…").start();
    const startedAt = Date.now();
    let pollingInterval = interval;

    return new Promise<string>((resolve, reject) => {
        const fail = (message: string): void => {
            spinner.fail(message);
            reject(new AuthError(message));
        };

        const poll = async (): Promise<void> => {
            if (Date.now() - startedAt > MAX_POLL_MS) {
                fail(
                    "Timed out waiting for authorization. Run `pagex login` to try again.",
                );
                return;
            }

            const { data, error } = await authClient.device.token({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                device_code: deviceCode,
                client_id: config.CLIENT_ID,
            });

            if (data?.access_token) {
                spinner.succeed("Authorization successful — you're logged in!");
                saveToken(data.access_token);
                resolve(data.access_token);
                return;
            }

            if (error) {
                switch (error.error) {
                    case "authorization_pending":
                        // still waiting — keep polling
                        break;

                    case "slow_down":
                        pollingInterval += 5;
                        spinner.text = `Slow down requested — polling every ${pollingInterval}s`;
                        break;

                    case "access_denied":
                        fail("Authorization denied. Run `pagex login` to try again.");
                        return;

                    case "expired_token":
                        fail("The verification code expired. Run `pagex login` to start again.");
                        return;

                    default:
                        fail(error.error_description ?? "Device authorization failed.");
                        return;
                }
            }

            setTimeout(poll, pollingInterval * 1000);
        };

        setTimeout(poll, pollingInterval * 1000);
    });
}
