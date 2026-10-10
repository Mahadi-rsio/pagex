import { MAX_BUILD_LOG_BYTES } from "@/server/api/constants";

/**
 * Pure decision helpers for the remote build system. Kept free of DB/network
 * access so the tricky parts (retry, lease reclaim, controller start/stop, log
 * bounding, redaction) are unit-testable without infrastructure.
 */

export type BuildStatus =
    | "queued"
    | "active"
    | "completed"
    | "failed"
    | "cancelled";

export type BuildStage =
    | "cloning"
    | "installing"
    | "building"
    | "deploying"
    | "ready";

export const TERMINAL_BUILD_STATUSES: ReadonlySet<string> = new Set([
    "completed",
    "failed",
    "cancelled",
]);

export function isTerminalStatus(status: string): boolean {
    return TERMINAL_BUILD_STATUSES.has(status);
}

/** A job may be retried while it still has attempts left. */
export function canRetry(attempts: number, maxAttempts: number): boolean {
    return attempts < maxAttempts;
}

export function isLeaseExpired(
    leaseExpiresAt: Date | null,
    now: Date,
): boolean {
    if (!leaseExpiresAt) return true;
    return leaseExpiresAt.getTime() <= now.getTime();
}

/**
 * What to do with an `active` job whose worker lease has expired (the machine
 * died mid-build). Requeue only if attempts remain, otherwise fail permanently.
 */
export function decideStaleReclaim(
    row: { attempts: number; max_attempts: number },
    leaseExpiresAt: Date | null,
    now: Date,
): "requeue" | "fail" | "none" {
    if (!isLeaseExpired(leaseExpiresAt, now)) return "none";
    return canRetry(row.attempts, row.max_attempts) ? "requeue" : "fail";
}

export interface BoundedLogResult {
    log: string;
    logBytes: number;
    truncated: boolean;
    appended: number;
}

/**
 * Append a chunk to a build log with a hard byte cap. Once the cap is reached
 * the log is frozen and flagged truncated, so a chatty or malicious build
 * cannot exhaust storage or memory.
 */
export function boundedLogAppend(
    existing: string,
    existingBytes: number,
    chunk: string,
    maxBytes: number = MAX_BUILD_LOG_BYTES,
    alreadyTruncated = false,
): BoundedLogResult {
    if (alreadyTruncated || existingBytes >= maxBytes) {
        return {
            log: existing,
            logBytes: existingBytes,
            truncated: true,
            appended: 0,
        };
    }

    const remaining = maxBytes - existingBytes;
    const chunkBytes = Buffer.byteLength(chunk, "utf8");
    if (chunkBytes <= remaining) {
        return {
            log: existing + chunk,
            logBytes: existingBytes + chunkBytes,
            truncated: false,
            appended: chunkBytes,
        };
    }

    // Truncate the chunk on a UTF-8 boundary. Slicing raw bytes can cut a
    // multibyte rune, so drop any trailing replacement character the decoder
    // produced (which would also push us back over the byte budget).
    const head = Buffer.from(chunk, "utf8").subarray(0, remaining);
    let sliced = head.toString("utf8");
    if (sliced.endsWith("\uFFFD")) {
        sliced = sliced.slice(0, -1);
    }
    const slicedBytes = Buffer.byteLength(sliced, "utf8");
    return {
        log: existing + sliced,
        logBytes: existingBytes + slicedBytes,
        truncated: true,
        appended: slicedBytes,
    };
}

const REDACTIONS: Array<[RegExp, string]> = [
    // Build job tokens (pxb.<uuid>.<hex>)
    [/\bpxb\.[0-9a-fA-F-]+\.[a-f0-9]+/g, "pxb.***.***"],
    // Authorization headers
    [/(authorization\s*:\s*bearer\s+)[^\s"']+/gi, "$1***"],
    // GitHub tokens (classic + fine-grained + app)
    [/\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, "***"],
    // GitHub PAT v2
    [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/g, "***"],
    // AWS access key ids
    [/\b(AKIA|ASIA)[0-9A-Z]{16}\b/g, "***"],
    // PEM private keys
    [
        /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
        "***REDACTED PRIVATE KEY***",
    ],
    // key=value style secrets
    [
        /((?:token|secret|password|passwd|api[_-]?key|access[_-]?key|auth)["'\s:=]+)([^\s"',]+)/gi,
        "$1***",
    ],
];

/** Strip credentials/secrets that a build or install step may have printed. */
export function redactSecrets(text: string): string {
    let out = text;
    for (const [re, replacement] of REDACTIONS) {
        out = out.replace(re, replacement);
    }
    return out;
}

/** Bound and redact an error message stored on the job / shown to the user. */
export function sanitizeError(error: unknown, maxLength = 2_000): string {
    const raw =
        error instanceof Error
            ? error.message
            : typeof error === "string"
              ? error
              : "Build failed";
    const cleaned = redactSecrets(raw).replace(/\s+/g, " ").trim();
    return cleaned.length > maxLength
        ? `${cleaned.slice(0, maxLength)}…`
        : cleaned;
}

export type MachineState =
    | "started"
    | "starting"
    | "stopped"
    | "stopping"
    | "suspended"
    | "unknown";

export interface ControllerInput {
    machineState: MachineState;
    hasQueued: boolean;
    hasActive: boolean;
}

/**
 * Decide whether the shared machine should be started or stopped.
 *
 * - Start whenever work exists and the machine is not already running/booting.
 * - Stop only when there is NO queued and NO active job. A queued job is a
 *   signal to keep it warm; an active job means stopping would kill a build.
 */
export function decideControllerAction(
    input: ControllerInput,
): "start" | "stop" | "none" {
    const { machineState, hasQueued, hasActive } = input;
    const hasWork = hasQueued || hasActive;

    if (hasWork) {
        if (
            machineState === "stopped" ||
            machineState === "suspended" ||
            machineState === "stopping" ||
            machineState === "unknown"
        ) {
            return "start";
        }
        return "none";
    }

    if (machineState === "started" || machineState === "starting") {
        return "stop";
    }
    return "none";
}

/** Map the Fly API `state` string to our narrow union. */
export function normalizeMachineState(state: string): MachineState {
    switch (state) {
        case "started":
        case "starting":
        case "stopped":
        case "stopping":
        case "suspended":
            return state;
        default:
            return "unknown";
    }
}
