import chalk from "chalk";
import ora, { type Ora } from "ora";

// ---------------------------------------------------------------------------
// Log level
// ---------------------------------------------------------------------------

export type LogLevel = "silent" | "normal" | "verbose";

let currentLevel: LogLevel = "normal";

export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

export function getLogLevel(): LogLevel {
    return currentLevel;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export const logger = {
    info(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.cyan(message));
    },

    success(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.green(`✔ ${message}`));
    },

    warn(message: string): void {
        if (currentLevel === "silent") return;
        console.warn(chalk.yellow(`⚠ ${message}`));
    },

    error(message: string): void {
        // errors always print, even in silent mode
        console.error(chalk.red(`✖ ${message}`));
    },

    verbose(message: string): void {
        if (currentLevel !== "verbose") return;
        console.log(chalk.gray(`[verbose] ${message}`));
    },

    /** Return a configured ora spinner. Callers are responsible for stopping it. */
    spinner(text: string): Ora {
        if (currentLevel === "silent") {
            // return a no-op spinner
            return ora({ text, isSilent: true });
        }
        return ora(text);
    },
};
