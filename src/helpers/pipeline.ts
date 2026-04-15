import { redis } from './../../lib/redis.js'

export async function processLogs(logs: any[]) {
    const pipeline = redis.pipeline()

    for (const log of logs) {
        if (!log.host) continue
        pipeline.incr(`requests:${log.host}`)
        pipeline.incrby(`bandwidth:${log.host}`, log.bytes || 0)
    }

    console.log("working pipline logs")

    await pipeline.exec()

}
