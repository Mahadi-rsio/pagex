import { randomUUID } from "node:crypto";
import {
    BUILD_MACHINE_LOCK_KEY,
    BUILD_MACHINE_LOCK_TTL_SECONDS,
} from "@/server/api/constants";
import { redis, redisKey } from "@/server/api/infrastructure/cache/redis";
import {
    decideControllerAction,
    type MachineState,
    normalizeMachineState,
} from "./build-policy";

/**
 * Fly Machines controller for the single shared build machine.
 *
 * There is exactly ONE machine and it runs at most one job at a time (no
 * persistent volume). The controller is the only thing allowed to start/stop
 * it, and it is wrapped in a Redis lock so concurrent controller invocations
 * cannot race a start against a stop.
 *
 * The controller only ever reads "is there work?" and issues start/stop; the
 * machine itself pulls jobs from `POST /api/builds/claim`. If the controller is
 * unavailable the DB still holds every job, so nothing is lost.
 */

export interface FlyConfig {
    apiToken: string;
    appName: string;
    machineId: string;
    host: string;
}

const DEFAULT_FLY_HOST = "https://api.machines.dev";

export function readFlyConfig(
    env: NodeJS.ProcessEnv = process.env,
): FlyConfig | null {
    const apiToken = env.FLY_API_TOKEN;
    const appName = env.FLY_APP_NAME;
    const machineId = env.FLY_MACHINE_ID;
    if (!apiToken || !appName || !machineId) return null;
    return {
        apiToken,
        appName,
        machineId,
        host: env.FLY_API_HOST || DEFAULT_FLY_HOST,
    };
}

export interface FlyClient {
    getState(): Promise<MachineState>;
    start(): Promise<void>;
    stop(): Promise<void>;
}

export type FetchLike = (
    input: string,
    init?: RequestInit,
) => Promise<Response>;

export function createFlyClient(
    config: FlyConfig,
    fetchImpl: FetchLike = fetch,
): FlyClient {
    const base = `${config.host}/v1/apps/${encodeURIComponent(
        config.appName,
    )}/machines/${encodeURIComponent(config.machineId)}`;
    const headers = {
        authorization: `Bearer ${config.apiToken}`,
        "content-type": "application/json",
    };

    return {
        async getState() {
            try {
                const res = await fetchImpl(base, { headers });
                if (!res.ok) return "unknown";
                const body = (await res.json()) as { state?: unknown };
                return normalizeMachineState(
                    typeof body.state === "string" ? body.state : "unknown",
                );
            } catch {
                return "unknown";
            }
        },
        async start() {
            const res = await fetchImpl(`${base}/start`, {
                method: "POST",
                headers,
            });
            if (!res.ok && res.status !== 409) {
                throw new Error(`Fly start failed: ${res.status}`);
            }
        },
        async stop() {
            const res = await fetchImpl(`${base}/stop`, {
                method: "POST",
                headers,
            });
            if (!res.ok && res.status !== 409) {
                throw new Error(`Fly stop failed: ${res.status}`);
            }
        },
    };
}

export interface ReconcileDeps {
    fly: FlyClient;
    hasQueued: boolean;
    hasActive: boolean;
    acquireLock: () => Promise<boolean>;
    releaseLock: () => Promise<void>;
}

/**
 * One reconciliation pass. The lock is taken first; if another controller holds
 * it we skip (the other invocation is doing the same work with fresher data).
 */
export async function reconcileMachine(
    deps: ReconcileDeps,
): Promise<"start" | "stop" | "none" | "skipped"> {
    const acquired = await deps.acquireLock();
    if (!acquired) return "skipped";

    try {
        const machineState = await deps.fly.getState();
        const action = decideControllerAction({
            machineState,
            hasQueued: deps.hasQueued,
            hasActive: deps.hasActive,
        });
        if (action === "start") await deps.fly.start();
        if (action === "stop") await deps.fly.stop();
        return action;
    } finally {
        await deps.releaseLock().catch(() => {});
    }
}

const RELEASE_LOCK_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Best-effort wake used right after a job is enqueued. Never throws. */
export async function wakeBuildMachine(): Promise<boolean> {
    const config = readFlyConfig();
    if (!config) return false;
    try {
        const client = createFlyClient(config);
        const state = await client.getState();
        if (
            state === "stopped" ||
            state === "suspended" ||
            state === "unknown"
        ) {
            await client.start();
        }
        return true;
    } catch (err) {
        console.error(
            "[fly-controller] wake failed:",
            err instanceof Error ? err.message : err,
        );
        return false;
    }
}

/**
 * Production controller tick: count work, reconcile the machine under a lock.
 * Safe to call from a cron, the queue consumer, or an external supervisor.
 */
export async function runBuildControllerTick(): Promise<string> {
    const config = readFlyConfig();
    if (!config) return "disabled";

    const holder = `controller:${randomUUID()}`;
    const acquireLock = async (): Promise<boolean> => {
        const res = await redis.set(redisKey(BUILD_MACHINE_LOCK_KEY), holder, {
            nx: true,
            ex: BUILD_MACHINE_LOCK_TTL_SECONDS,
        });
        return res === "OK";
    };
    const releaseLock = async (): Promise<void> => {
        await redis.eval(
            RELEASE_LOCK_LUA,
            [redisKey(BUILD_MACHINE_LOCK_KEY)],
            [holder],
        );
    };

    const { countBuildsByStatus } = await import("./build.store");
    const [queued, active] = await Promise.all([
        countBuildsByStatus(["queued"]),
        countBuildsByStatus(["active"]),
    ]);

    return reconcileMachine({
        fly: createFlyClient(config),
        hasQueued: queued > 0,
        hasActive: active > 0,
        acquireLock,
        releaseLock,
    });
}
