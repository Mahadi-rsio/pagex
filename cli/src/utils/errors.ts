import chalk from "chalk";

// ---------------------------------------------------------------------------
// Error hierarchy
// ---------------------------------------------------------------------------

export class PagexError extends Error {
    constructor(
        message: string,
        public readonly exitCode: number = 1,
    ) {
        super(message);
        this.name = "PagexError";
    }
}

export class AuthError extends PagexError {
    constructor(message = "Authentication failed. Please run `pagex login`.") {
        super(message, 1);
        this.name = "AuthError";
    }
}

export class NetworkError extends PagexError {
    constructor(message: string) {
        super(message, 1);
        this.name = "NetworkError";
    }
}

export class ConfigError extends PagexError {
    constructor(message: string) {
        super(message, 1);
        this.name = "ConfigError";
    }
}

// ---------------------------------------------------------------------------
// Central error handler
// ---------------------------------------------------------------------------

/**
 * Format and print an error, then exit the process with the appropriate code.
 * Understands our custom PagexError hierarchy as well as plain Error objects.
 */
export function handleError(err: unknown): never {
    const hints: string[] = [];

    if (err instanceof Error && err.cause) {
        hints.push(`Cause: ${String(err.cause)}`);
    }

    if (err instanceof NetworkError) {
        console.error(chalk.red(`\n[Network Error] ${err.message}`));
        hints.push("Check your connection and the PAGEX_API_URL setting, then retry.");
    } else if (err instanceof AuthError) {
        console.error(chalk.red(`\n[Auth Error] ${err.message}`));
        if (!err.message.includes("pagex login")) {
            hints.push("Run `pagex login` to authenticate.");
        }
    } else if (err instanceof ConfigError) {
        console.error(chalk.red(`\n[Config Error] ${err.message}`));
        hints.push("Re-run the command after fixing the issue. Use --verbose for details.");
    } else if (err instanceof PagexError) {
        console.error(chalk.red(`\n[Error] ${err.message}`));
    } else if (err instanceof Error) {
        console.error(chalk.red(`\n[Unexpected Error] ${err.message}`));
        hints.push("This is likely a bug. Re-run with --verbose for a full stack trace.");
    } else {
        console.error(chalk.red(`\n[Unknown Error] ${String(err)}`));
    }

    for (const hint of hints) {
        console.error(chalk.dim(`\n  → ${hint}`));
    }

    const exitCode = err instanceof PagexError ? err.exitCode : 1;
    process.exit(exitCode);
}
