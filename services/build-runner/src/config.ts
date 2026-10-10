import os from "node:os";

/**
 * Runtime configuration for the shared build machine. Everything is read from
 * the process environment so the same image can run anywhere.
 *
 * The machine only ever holds two secrets: `BUILD_MACHINE_TOKEN` (to claim
 * jobs) and the per-job token it receives at claim time. Neither is ever passed
 * to project build scripts.
 */
export interface RunnerConfig {
    /** Console origin, e.g. https://console.pagex.cloud */
    consoleUrl: string;
    /** Shared secret authenticating the machine to the console. */
    machineToken: string;
    /** Stable-ish identity for lease ownership. */
    workerId: string;
    /** Scratch parent directory for per-job workspaces. */
    workspaceDir: string;
    /** Hard cap for clone + install + build + deploy of a single job. */
    jobTimeoutMs: number;
    /** Lease heartbeat interval. */
    heartbeatIntervalMs: number;
    /** Path to the built PageX CLI entry (dist/index.js). */
    cliEntry: string;
    /** Extra env vars allowed to pass through to build scripts. */
    passThroughEnv: string[];
}

function required(env: NodeJS.ProcessEnv, name: string): string {
    const value = env[name];
    if (!value) throw new Error(`${name} environment variable is required`);
    return value;
}

export function readConfig(env: NodeJS.ProcessEnv = process.env): RunnerConfig {
    return {
        consoleUrl: required(env, "CONSOLE_URL").replace(/\/+$/, ""),
        machineToken: required(env, "BUILD_MACHINE_TOKEN"),
        workerId:
            env.WORKER_ID ||
            env.FLY_MACHINE_ID ||
            `${os.hostname()}-${process.pid}`,
        workspaceDir: env.BUILD_WORKSPACE_DIR || os.tmpdir(),
        jobTimeoutMs: Number(env.BUILD_TIMEOUT_MS ?? 20 * 60 * 1000),
        heartbeatIntervalMs: Number(env.BUILD_HEARTBEAT_MS ?? 60 * 1000),
        cliEntry: env.PAGEX_CLI_ENTRY || "pagex",
        passThroughEnv: (env.BUILD_PASSTHROUGH_ENV ?? "")
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean),
    };
}
