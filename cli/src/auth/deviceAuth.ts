import { createAuthClient } from "better-auth/client";
import { deviceAuthorizationClient } from "better-auth/client/plugins";
import open from "open";
import chalk from "chalk";
import { saveToken } from "../utils/session.js";
import { jwtClient } from "better-auth/client/plugins";
import { config } from "../config.js";
import { logger } from "../utils/logger.js";

export const authClient = createAuthClient({
    baseURL: config.AUTH_BASE_URL,
    plugins: [
        deviceAuthorizationClient(),
        jwtClient(),
    ],
});

export async function deviceLogin() {
    const spinner = logger.spinner("Requesting device authorization").start();

    const { data, error } = await authClient.device.code({
        client_id: config.CLIENT_ID,
        scope: "openid profile email",
    });

    if (error || !data) {
        spinner.fail("Failed to start auth");
        throw new Error(error?.error_description);
    }

    spinner.stop();

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

    console.log(chalk.cyan("\nDevice Authorization"));
    console.log(chalk.yellow(`Code: ${user_code}`));
    console.log(chalk.green(`Visit: ${publicUrl}\n`));

    await open(publicUrl).catch(() => {
        logger.warn(
            "Could not open a browser automatically — open the URL above manually.",
        );
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

async function pollForToken(deviceCode: string, interval: number) {
    const spinner = logger.spinner("Waiting for authorization").start();

    let pollingInterval = interval;

    return new Promise<string>((resolve, reject) => {
        const poll = async () => {
            const { data, error } = await authClient.device.token({
                grant_type: "urn:ietf:params:oauth:grant-type:device_code",
                device_code: deviceCode,
                client_id: config.CLIENT_ID,
            });



            if (data?.access_token) {
                spinner.succeed("Authorization successful");
                resolve(data.access_token);
                saveToken(data.access_token)
                return;
            }

            if (error) {
                switch (error.error) {
                    case "authorization_pending":
                        break;

                    case "slow_down":
                        pollingInterval += 5;
                        spinner.text = `Slowing down polling (${pollingInterval}s)`;
                        break;

                    case "access_denied":
                        spinner.fail("User denied access");
                        reject("Access denied");
                        return;

                    case "expired_token":
                        spinner.fail("Device code expired");
                        reject("Token expired");
                        return;

                    default:
                        spinner.fail(error.error_description);
                        reject(error.error_description);
                        return;
                }
            }

            setTimeout(poll, pollingInterval * 1000);
        };

        setTimeout(poll, pollingInterval * 1000);
    });
}
