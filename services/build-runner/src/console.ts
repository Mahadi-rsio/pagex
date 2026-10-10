/**
 * Thin HTTP client for the console build API. Uses only `fetch` with bounded
 * timeouts; every call carries either the machine token (claim/controller) or a
 * per-job token (logs/heartbeat/complete).
 */

export interface ClaimedJob {
    build: {
        id: string;
        page_id: string;
        status: string;
        repo_url: string;
        branch: string;
        commit_sha: string | null;
        framework: string;
        build_command: string | null;
        output_dir: string | null;
    };
    token: string;
    commit_sha: string | null;
    repo_url: string;
    branch: string;
    framework: string;
    build_command: string | null;
    output_dir: string | null;
}

export type BuildStage =
    | "cloning"
    | "installing"
    | "building"
    | "deploying"
    | "ready";

export interface ConsoleClient {
    claim(workerId: string): Promise<ClaimedJob | null>;
    appendLog(
        buildId: string,
        token: string,
        workerId: string,
        chunk: string,
        stage?: BuildStage,
    ): Promise<void>;
    heartbeat(buildId: string, token: string, workerId: string): Promise<void>;
    complete(
        buildId: string,
        token: string,
        workerId: string,
        body:
            | { status: "completed"; deploymentId: string; stage?: BuildStage }
            | { status: "failed"; error: string; stage?: BuildStage },
    ): Promise<void>;
    controllerTick(): Promise<void>;
}

const REQUEST_TIMEOUT_MS = 30_000;

/** HTTP error carrying the status code and optional Retry-After (ms) on 429. */
export class ConsoleHttpError extends Error {
    readonly status: number;
    readonly retryAfterMs: number | null;

    constructor(operation: string, status: number, retryAfterMs: number | null) {
        super(`${operation} failed: ${status}`);
        this.name = "ConsoleHttpError";
        this.status = status;
        this.retryAfterMs = retryAfterMs;
    }
}

function retryAfterMs(res: Response): number | null {
    const header = res.headers.get("retry-after");
    if (!header) return null;
    const value = Number(header);
    return Number.isFinite(value) && value >= 0 ? value * 1000 : null;
}

export function createConsoleClient(
    consoleUrl: string,
    machineToken: string,
    fetchImpl: typeof fetch = fetch,
): ConsoleClient {
    const base = consoleUrl.replace(/\/+$/, "");
    const post = (url: string, token: string, body: unknown) =>
        fetchImpl(url, {
            method: "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

    const requireOk = async (res: Response, operation: string) => {
        if (!res.ok) {
            throw new ConsoleHttpError(
                operation,
                res.status,
                retryAfterMs(res),
            );
        }
        return res;
    };

    return {
        async claim(workerId) {
            const res = await post(`${base}/api/builds/claim`, machineToken, {
                workerId,
            });
            await requireOk(res, "claim");
            const data = (await res.json()) as { job: ClaimedJob | null };
            return data.job;
        },

        async appendLog(buildId, token, workerId, chunk, stage) {
            const res = await post(
                `${base}/api/builds/${buildId}/logs`,
                token,
                stage ? { workerId, chunk, stage } : { workerId, chunk },
            );
            await requireOk(res, "appendLog");
        },

        async heartbeat(buildId, token, workerId) {
            const res = await post(
                `${base}/api/builds/${buildId}/heartbeat`,
                token,
                { workerId },
            );
            await requireOk(res, "heartbeat");
        },

        async complete(buildId, token, workerId, body) {
            const res = await post(
                `${base}/api/builds/${buildId}/complete`,
                token,
                { workerId, ...body },
            );
            await requireOk(res, "complete");
        },

        async controllerTick() {
            const res = await post(
                `${base}/api/internal/builds/controller`,
                machineToken,
                {},
            );
            await requireOk(res, "controller tick");
        },
    };
}
