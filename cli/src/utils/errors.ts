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
    if (err instanceof AuthError) {
        console.error(chalk.red(`\n[Auth Error] ${err.message}`));
    } else if (err instanceof NetworkError) {
        console.error(chalk.red(`\n[Network Error] ${err.message}`));
    } else if (err instanceof ConfigError) {
        console.error(chalk.red(`\n[Config Error] ${err.message}`));
    } else if (err instanceof PagexError) {
        console.error(chalk.red(`\n[Error] ${err.message}`));
    } else if (err instanceof Error) {
        console.error(chalk.red(`\n[Unexpected Error] ${err.message}`));
    } else {
        console.error(chalk.red(`\n[Unknown Error] ${String(err)}`));
    }

    const exitCode = err instanceof PagexError ? err.exitCode : 1;
    process.exit(exitCode);
}
