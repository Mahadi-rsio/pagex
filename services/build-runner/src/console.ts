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

    return {
        async claim(workerId) {
            const res = await post(`${base}/api/builds/claim`, machineToken, {
                workerId,
            });
            if (!res.ok) throw new Error(`claim failed: ${res.status}`);
            const data = (await res.json()) as { job: ClaimedJob | null };
            return data.job;
        },

        async appendLog(buildId, token, workerId, chunk, stage) {
            const res = await post(
                `${base}/api/builds/${buildId}/logs`,
                token,
                stage ? { workerId, chunk, stage } : { workerId, chunk },
            );
            if (!res.ok) throw new Error(`appendLog failed: ${res.status}`);
        },

        async heartbeat(buildId, token, workerId) {
            const res = await post(
                `${base}/api/builds/${buildId}/heartbeat`,
                token,
                { workerId },
            );
            if (!res.ok) throw new Error(`heartbeat failed: ${res.status}`);
        },

        async complete(buildId, token, workerId, body) {
            const res = await post(
                `${base}/api/builds/${buildId}/complete`,
                token,
                { workerId, ...body },
            );
            if (!res.ok) throw new Error(`complete failed: ${res.status}`);
        },

        async controllerTick() {
            const res = await post(
                `${base}/api/internal/builds/controller`,
                machineToken,
                {},
            );
            if (!res.ok) throw new Error(`controller tick failed: ${res.status}`);
        },
    };
}
