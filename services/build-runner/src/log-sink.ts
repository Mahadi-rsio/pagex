/**
 * Reliable, bounded log delivery for the build runner.
 *
 * Replaces the previous fire-and-forget `safeAppend` (one unbounded HTTP POST
 * per output chunk, failures silently dropped) with a single serialized sink:
 *
 *  - chunks are buffered and coalesced into batched flushes,
 *  - flushes are serialized so log order is preserved,
 *  - a bounded queue applies backpressure so a chatty build cannot balloon
 *    memory,
 *  - transient failures retry with exponential backoff + jitter and honour
 *    `Retry-After` on 429,
 *  - permanent failures (e.g. 403) are surfaced as a diagnostic and dropped
 *    rather than retried forever or recursively generating more log traffic.
 *
 * Logs are **best-effort but ordered and bounded**: a console outage will drop
 * the tail of the log rather than stall the build, and the build outcome is
 * always reported via `complete` regardless of log-delivery state.
 */

import {
    type ConsoleClient,
    type BuildStage,
    ConsoleHttpError,
} from "./console.js";

export interface LogSinkOptions {
    /** Max bytes buffered before a flush is forced. */
    maxBatchBytes: number;
    /** Max wall time between flushes. */
    flushIntervalMs: number;
    /** Hard cap on pending un-flushed bytes (backpressure beyond this drops). */
    maxPendingBytes: number;
    /** Base delay for the first retry. */
    baseRetryMs: number;
    /** Cap on the backoff delay. */
    maxRetryMs: number;
    /** Max consecutive flush attempts for one batch before it is dropped. */
    maxRetries: number;
}

export const DEFAULT_LOG_SINK_OPTIONS: LogSinkOptions = {
    maxBatchBytes: 48 * 1024,
    flushIntervalMs: 1_000,
    maxPendingBytes: 256 * 1024,
    baseRetryMs: 250,
    maxRetryMs: 8_000,
    maxRetries: 5,
};

export interface LogSink {
    append(chunk: string, stage?: BuildStage): void;
    /** Flush any buffered logs and settle the retry queue. */
    flush(): Promise<void>;
    /** Number of bytes currently queued but not yet durably flushed. */
    pendingBytes(): number;
    /** Number of bytes dropped due to backpressure / permanent failure. */
    droppedBytes(): number;
    /** Drop all buffered logs (used on fatal shutdown). */
    dispose(): void;
}

export function createLogSink(
    client: ConsoleClient,
    buildId: string,
    token: string,
    workerId: string,
    options: LogSinkOptions = DEFAULT_LOG_SINK_OPTIONS,
): LogSink {
    let buffer: string[] = [];
    let bufferBytes = 0;
    let pendingBytes = 0;
    let droppedBytes = 0;
    let flushTimer: NodeJS.Timeout | null = null;
    let flushing = false;
    let disposed = false;

    // Serialized flush queue: only one HTTP request in flight at a time, in order.
    let queue: Array<{ chunks: string[]; stage?: BuildStage }> = [];

    const startTimer = () => {
        if (flushTimer || disposed) return;
        flushTimer = setTimeout(() => {
            flushTimer = null;
            void triggerFlush();
        }, options.flushIntervalMs);
    };

    const append = (chunk: string, stage?: BuildStage) => {
        if (disposed) return;
        const bytes = Buffer.byteLength(chunk, "utf8");
        if (bytes === 0) return;

        // Backpressure: drop the new chunk if the un-flushed backlog already
        // exceeds the cap, so a chatty build cannot consume unbounded memory.
        if (pendingBytes + bytes > options.maxPendingBytes) {
            droppedBytes += bytes;
            return;
        }

        buffer.push(chunk);
        bufferBytes += bytes;
        pendingBytes += bytes;

        if (bufferBytes >= options.maxBatchBytes) {
            void triggerFlush();
        } else {
            startTimer();
        }
    };

    const triggerFlush = async () => {
        if (flushing) return;
        flushing = true;
        try {
            await drain();
        } finally {
            flushing = false;
        }
    };

    const drain = async () => {
        if (buffer.length > 0) {
            queue.push({ chunks: buffer, stage: undefined });
            buffer = [];
            bufferBytes = 0;
        }
        if (disposed) return;

        while (queue.length > 0 && !disposed) {
            const batch = queue[0]!;
            const accepted = await flushBatch(batch);
            for (const c of batch.chunks) {
                pendingBytes -= Buffer.byteLength(c, "utf8");
            }
            queue.shift();
            if (!accepted) {
                // Permanent failure or retries exhausted: surface as dropped.
                for (const c of batch.chunks) {
                    droppedBytes += Buffer.byteLength(c, "utf8");
                }
            }
        }
    };

    /** Returns true if the batch was delivered, false if it must be dropped. */
    const flushBatch = async (batch: {
        chunks: string[];
        stage?: BuildStage;
    }): Promise<boolean> => {
        const text = batch.chunks.join("");
        const { chunkLog } = await import("./log.js");
        const pieces = chunkLog(text, 60 * 1024);

        let attempt = 0;
        while (attempt <= options.maxRetries) {
            if (disposed) return true;
            try {
                for (const piece of pieces) {
                    await client.appendLog(
                        buildId,
                        token,
                        workerId,
                        piece,
                        batch.stage,
                    );
                }
                return true;
            } catch (err) {
                if (err instanceof ConsoleHttpError) {
                    if (err.status === 429) {
                        // Honour Retry-After when provided, otherwise back off.
                        const delay = Math.min(
                            err.retryAfterMs ?? options.maxRetryMs,
                            options.maxRetryMs,
                        );
                        await sleep(delay + jitter());
                        attempt++;
                        continue;
                    }
                    if (err.status < 500 && err.status !== 408) {
                        // Permanent client error (400/401/403/404/409/422).
                        return false;
                    }
                    // 5xx / 408: transient.
                }
                if (attempt >= options.maxRetries) return false;
                const backoff = Math.min(
                    options.baseRetryMs * 2 ** attempt,
                    options.maxRetryMs,
                );
                await sleep(backoff + jitter());
                attempt++;
            }
        }
        return false;
    };

    const flush = async () => {
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        if (disposed) return;
        await triggerFlush();
        while (flushing) {
            await sleep(10);
        }
    };

    const dispose = () => {
        disposed = true;
        if (flushTimer) {
            clearTimeout(flushTimer);
            flushTimer = null;
        }
        queue = [];
        buffer = [];
        bufferBytes = 0;
    };

    return {
        append,
        flush,
        pendingBytes: () => pendingBytes,
        droppedBytes: () => droppedBytes,
        dispose,
    };
}

function jitter(): number {
    return Math.floor(Math.random() * 150);
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
