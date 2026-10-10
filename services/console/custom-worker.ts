/**
 * Custom worker entry point for the PageX console.
 *
 * Re-uses the OpenNext-generated fetch handler and adds a `scheduled` handler
 * so the build-machine controller tick runs on a cron even when no request
 * wakes it. This is the backstop for the enqueue-time `wakeBuildMachine()`:
 * if the machine is stopped while queued work exists (or the wake silently
 * failed, e.g. missing Fly secrets), the cron self-fetches the controller
 * route, which reconciles stale leases and starts the machine.
 *
 * The self-fetch goes through `WORKER_SELF_REFERENCE`, the same service
 * binding the OpenNext DO queue handler uses, so the request is processed by
 * the full fetch pipeline (middleware, route auth via BUILD_MACHINE_TOKEN).
 */

// @ts-ignore `.open-next/worker.ts` is generated at build time
import { default as handler } from "./.open-next/worker.js";

// The re-export is required when the app uses the DO Queue / DO Tag Cache.
// @ts-ignore `.open-next/worker.ts` is generated at build time
export {
    DOQueueHandler,
    DOShardedTagCache,
    BucketCachePurge,
} from "./.open-next/worker.js";

const CONTROLLER_PATH = "/api/internal/builds/controller";

export default {
    fetch: handler.fetch,

    async scheduled(controller, env: CloudflareEnv) {
        const token = (env as { BUILD_MACHINE_TOKEN?: string })
            .BUILD_MACHINE_TOKEN;
        if (!token) {
            console.warn(
                "[build-controller-cron] BUILD_MACHINE_TOKEN not configured; " +
                    "skipping controller tick",
            );
            return;
        }

        const selfReference = env.WORKER_SELF_REFERENCE;
        if (!selfReference) {
            console.warn(
                "[build-controller-cron] WORKER_SELF_REFERENCE binding not " +
                    "configured; skipping controller tick",
            );
            return;
        }

        try {
            const response = await selfReference.fetch(
                new Request(
                    `https://pagex-console.internal${CONTROLLER_PATH}`,
                    {
                        method: "POST",
                        headers: {
                            authorization: `Bearer ${token}`,
                        },
                    },
                ),
            );
            if (!response.ok) {
                console.error(
                    `[build-controller-cron] controller tick failed: ` +
                        `${response.status}`,
                );
            }
        } catch (error) {
            console.error(
                "[build-controller-cron] controller tick error",
                error,
            );
        }
    },
} satisfies ExportedHandler<CloudflareEnv>;
