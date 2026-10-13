interface Env {
    FLY_APP: string;
    FLY_MACHINE_ID: string;
    FLY_API_TOKEN: string;
}

interface CronController {
    scheduledTime: number;
    cron: string;
    noRetry(): void;
}

interface CronContext {
    waitUntil(promise: Promise<unknown>): void;
}

// Start the one-shot Fly machine that drains the queue and folds pending R2
// objects into Neon. 409/422 mean "already running / no-op" and are treated as
// success so overlapping schedule ticks do not pile up as errors.
async function startMachine(env: Env): Promise<number> {
    const url = `https://api.machines.dev/v1/apps/${env.FLY_APP}/machines/${env.FLY_MACHINE_ID}/start`;
    const resp = await fetch(url, {
        method: "POST",
        headers: {
            authorization: `Bearer ${env.FLY_API_TOKEN}`,
            "content-type": "application/json",
        },
    });

    if (resp.ok || resp.status === 409 || resp.status === 422) {
        return resp.status;
    }
    const body = await resp.text();
    throw new Error(`fly machine start failed: HTTP ${resp.status}: ${body}`);
}

export default {
    async scheduled(
        _controller: CronController,
        env: Env,
        ctx: CronContext,
    ): Promise<void> {
        ctx.waitUntil(
            startMachine(env).then(
                (status) => console.log(`fly machine start: HTTP ${status}`),
                (err) => console.error(`fly machine start failed: ${err}`),
            ),
        );
    },

    async fetch(
        request: Request,
        env: Env,
        _ctx: CronContext,
    ): Promise<Response> {
        const { pathname } = new URL(request.url);
        if (request.method !== "POST" || pathname !== "/start") {
            return new Response("not found\n", { status: 404 });
        }
        try {
            const status = await startMachine(env);
            return new Response(`started (HTTP ${status})\n`, { status: 200 });
        } catch (err) {
            return new Response(`${err}\n`, { status: 502 });
        }
    },
};
