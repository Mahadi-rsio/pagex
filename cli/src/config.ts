import "dotenv/config";

/**
 * Centralized configuration module.
 * All configurable values are read here; the rest of the codebase imports from this file.
 */

const HOME = process.env["HOME"] ?? process.env["USERPROFILE"] ?? ".";

export const config = {
    /** Base URL for the PageX API. Override with PAGEX_API_URL env var. */
    API_BASE_URL: process.env["PAGEX_API_URL"] ?? "http://localhost:3000",

    /** Base URL for the auth/console server. Override with PAGEX_AUTH_URL env var. */
    AUTH_BASE_URL: process.env["PAGEX_AUTH_URL"] ?? "http://localhost:3000",

    /** OAuth client ID used in the device-flow auth. */
    CLIENT_ID: process.env["PAGEX_CLIENT_ID"] ?? "pagex",

    /** Absolute path to the local session file that stores the access token. */
    SESSION_FILE_PATH: `${HOME}/.pagex.session.json`,

    /** Name of the project link file written by `pagex init`. */
    CONFIG_FILE: "pagex.json",

    /** Build output directories, checked in order during deployment. */
    BUILD_DIRS: ["dist", "build", ".next", "out"] as const,
} as const;
