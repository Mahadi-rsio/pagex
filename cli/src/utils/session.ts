import fs from "fs";
import path from "path";
import { authClient } from "../auth/deviceAuth.js";
import { config } from "../config.js";
import { AuthError } from "./errors.js";
import { logger } from "./logger.js";

const sessionFile = config.SESSION_FILE_PATH;

interface SessionData {
    user?: {
        id?: string;
        name?: string;
        email?: string;
    };
}

export function saveToken(token: string): void {
    fs.mkdirSync(path.dirname(sessionFile), { recursive: true });
    fs.writeFileSync(sessionFile, JSON.stringify({ access_token: token }, null, 2));
}

export function getToken(): string | null {
    if (!fs.existsSync(sessionFile)) return null;

    try {
        const data = JSON.parse(fs.readFileSync(sessionFile, "utf8")) as {
            access_token?: unknown;
        };
        return typeof data.access_token === "string" ? data.access_token : null;
    } catch {
        // Corrupt or truncated session file — treat as not logged in.
        return null;
    }
}

/** Remove the saved session; returns true if a session file existed. */
export function clearToken(): boolean {
    if (fs.existsSync(sessionFile)) {
        fs.unlinkSync(sessionFile);
        return true;
    }
    return false;
}

/** Verify the stored session against the auth server. */
export async function checkStatus(): Promise<{ valid: true; uid: string; session: SessionData["user"] }> {
    if (!getToken()) {
        throw new AuthError("You are not logged in. Please run `pagex login`.");
    }

    const { data, error } = await authClient.getSession({
        fetchOptions: {
            headers: {
                Authorization: `Bearer ${getToken()}`,
            },
        },
    });

    if (error || !data) {
        throw new AuthError("Your session is invalid or expired. Please run `pagex login`.");
    }

    logger.verbose(`Authenticated as ${data.user?.name ?? data.user?.id ?? "unknown"}`);

    return {
        valid: true,
        uid: data.user.id ?? "",
        session: data.user,
    };
}
