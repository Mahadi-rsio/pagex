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
    /** Plain informational output (cyan tint). */
    info(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.cyan(message));
    },

    /** Success confirmation (green + checkmark). */
    success(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.green(`✔ ${message}`));
    },

    /** Warning (yellow + triangle). */
    warn(message: string): void {
        if (currentLevel === "silent") return;
        console.warn(chalk.yellow(`⚠ ${message}`));
    },

    /** Errors always print, even in silent mode. */
    error(message: string): void {
        console.error(chalk.red(`✖ ${message}`));
    },

    /** Verbose/debug output, only shown with --verbose. */
    verbose(message: string): void {
        if (currentLevel !== "verbose") return;
        console.log(chalk.gray(`[verbose] ${message}`));
    },

    /** Muted helper text such as next-step hints and secondary details. */
    hint(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.dim(chalk.gray(message)));
    },

    /** Emphasized (bold) message, e.g. values inside a summary block. */
    bold(message: string): void {
        if (currentLevel === "silent") return;
        console.log(chalk.bold(message));
    },

    /**
     * Numbered step line: "1. Message". Useful for linear, user-facing flows
     * like deployment so progress stays readable even without a spinner.
     */
    step(step: number, message: string): void {
        if (currentLevel === "silent") return;
        console.log(`${chalk.bold(chalk.cyan(`${step}.`))} ${message}`);
    },

    /** Render a subtle "next step" hint, e.g. `  next: $ pagex deploy`. */
    hintCommand(command: string, note?: string): void {
        if (currentLevel === "silent") return;
        const label = note ? `${note} ` : "next: ";
        console.log(chalk.dim(`${label}$ ${command}`));
    },

    /** Return a configured ora spinner. Callers are responsible for stopping it. */
    spinner(text: string): Ora {
        if (currentLevel === "silent") {
            // return a no-op spinner
            return ora({ text, isSilent: true });
        }
        return ora({ text, color: "cyan", spinner: "dots" });
    },
};
