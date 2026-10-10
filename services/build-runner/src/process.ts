import { spawn } from "node:child_process";

export interface RunOptions {
    cwd: string;
    env: Record<string, string>;
    timeoutMs: number;
    onOutput?: (chunk: string, stream: "stdout" | "stderr") => void;
    signal?: AbortSignal;
}

export interface RunResult {
    code: number | null;
    timedOut: boolean;
}

/**
 * Run a command to completion with a hard timeout and output capture.
 *
 * The child is started in its own process group so a timeout kills the whole
 * tree (build tools spawn watchers/daemons that would otherwise leak).
 */
export function run(
    command: string,
    args: string[],
    options: RunOptions,
): Promise<RunResult> {
    return new Promise((resolve, reject) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            env: options.env,
            stdio: ["ignore", "pipe", "pipe"],
            detached: true,
            shell: false,
        });

        let timedOut = false;
        let settled = false;

        const kill = () => {
            try {
                if (child.pid) process.kill(-child.pid, "SIGKILL");
            } catch {
                try {
                    child.kill("SIGKILL");
                } catch {
                    /* already gone */
                }
            }
        };

        const timer = setTimeout(() => {
            timedOut = true;
            kill();
        }, options.timeoutMs);

        const abort = () => kill();
        options.signal?.addEventListener("abort", abort, { once: true });

        const emit = (buf: Buffer, stream: "stdout" | "stderr") => {
            if (options.onOutput) options.onOutput(buf.toString("utf8"), stream);
        };
        child.stdout?.on("data", (b: Buffer) => emit(b, "stdout"));
        child.stderr?.on("data", (b: Buffer) => emit(b, "stderr"));

        child.on("error", (err) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            reject(err);
        });

        child.on("exit", (code) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal?.removeEventListener("abort", abort);
            resolve({ code, timedOut });
        });
    });
}
