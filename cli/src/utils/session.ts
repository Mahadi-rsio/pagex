import fs from "fs";
import { authClient } from "../auth/deviceAuth.js";
import { config } from "../config.js";
import { AuthError } from "./errors.js";
import { logger } from "./logger.js";

const sessionFile = config.SESSION_FILE_PATH;

export function saveToken(token: string) {
    fs.writeFileSync(sessionFile, JSON.stringify({
        access_token: token
    }));
}

export function getToken() {
    if (!fs.existsSync(sessionFile)) return null;

    const data = fs.readFileSync(sessionFile, "utf8");
    const session = JSON.parse(data);
    return session.access_token
}

export function clearToken() {
    if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
    }
}

export async function checkStatus() {
    const { data, error } = await authClient.getSession({
        fetchOptions: {
            headers: {
                Authorization: `Bearer ${getToken()}`,
            },
        },
    });

    if (error || !data) {
        throw new AuthError("You are not logged in. Please run `pagex login`.");
    }

    logger.info(`Deploy started for ${data.user.id}: ${data.user.name}`);

    return {
        valid: true,
        uid: data.user.id,
    };
}
