import { readConfig } from "./config.js";
import { createConsoleClient } from "./console.js";
import { runUntilIdle, type Logger } from "./runner.js";

/**
 * Build machine entrypoint. The Fly controller starts this process (usually via
 * a queued wake) and the process drains the build queue then idles the machine
 * through a controller tick. It never runs indefinitely holding resources.
 */
async function main(): Promise<void> {
    const logger: Logger = {
        info: (msg) => console.log(`[build-runner] ${msg}`),
        error: (msg, err) => console.error(`[build-runner] ${msg}`, err ?? ""),
    };

    const config = readConfig();
    const client = createConsoleClient(config.consoleUrl, config.machineToken);
    logger.info(`worker ${config.workerId} polling ${config.consoleUrl}`);

    const processed = await runUntilIdle({ client, config, logger });
    logger.info(`drained queue: processed ${processed} build(s)`);
}

main().catch((err) => {
    console.error("[build-runner] fatal:", err);
    process.exitCode = 1;
});
