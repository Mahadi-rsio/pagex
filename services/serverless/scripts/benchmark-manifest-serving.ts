/**
 * Compare manifest-based path resolution (in-memory) vs simulated DB lookup latency.
 *
 *   npx tsx scripts/benchmark-manifest-serving.ts
 */
import { performance } from 'node:perf_hooks'

const FILE_COUNT = 5000
const REQUESTS = 50_000

function buildManifest(fileCount: number): Record<string, string> {
    const files: Record<string, string> = {}
    for (let i = 0; i < fileCount; i++) {
        files[`assets/file-${i}.js`] = 'a'.repeat(64)
    }
    files['index.html'] = 'b'.repeat(64)
    return files
}

function percentile(values: number[], p: number): number {
    const sorted = [...values].sort((a, b) => a - b)
    const idx = Math.ceil((p / 100) * sorted.length) - 1
    return sorted[Math.max(0, idx)]!
}

async function simulateDbLookup(): Promise<number> {
    // ~0.5ms simulated PG round-trip per request (old architecture)
    await new Promise((r) => setTimeout(r, 0.5))
    return 0.5
}

function manifestLookup(files: Record<string, string>, path: string): string | undefined {
    return files[path]
}

async function main() {
    const files = buildManifest(FILE_COUNT)
    const paths = ['index.html', 'assets/file-42.js', 'assets/file-999.js', 'missing.html']

    const oldLatencies: number[] = []
    for (let i = 0; i < REQUESTS; i++) {
        const t0 = performance.now()
        await simulateDbLookup()
        oldLatencies.push(performance.now() - t0)
    }

    const newLatencies: number[] = []
    for (let i = 0; i < REQUESTS; i++) {
        const path = paths[i % paths.length]!
        const t0 = performance.now()
        manifestLookup(files, path)
        newLatencies.push(performance.now() - t0)
    }

    const oldRps = REQUESTS / (oldLatencies.reduce((a, b) => a + b, 0) / 1000)
    const newRps = REQUESTS / (newLatencies.reduce((a, b) => a + b, 0) / 1000)

    console.log('Benchmark (simulated old DB path vs in-memory manifest lookup)')
    console.log(`Requests: ${REQUESTS}, manifest files: ${FILE_COUNT}`)
    console.log('')
    console.log('| Metric | Old (DB query) | New (manifest L1) |')
    console.log('|--------|----------------|-------------------|')
    console.log(`| req/s | ${oldRps.toFixed(0)} | ${newRps.toFixed(0)} |`)
    console.log(`| p50 ms | ${percentile(oldLatencies, 50).toFixed(4)} | ${percentile(newLatencies, 50).toFixed(4)} |`)
    console.log(`| p95 ms | ${percentile(oldLatencies, 95).toFixed(4)} | ${percentile(newLatencies, 95).toFixed(4)} |`)
    console.log(`| p99 ms | ${percentile(oldLatencies, 99).toFixed(4)} | ${percentile(newLatencies, 99).toFixed(4)} |`)
    console.log('')
    console.log('Hot-path target (warm L1 manifest + blob cache):')
    console.log('  PostgreSQL queries/request = 0')
    console.log('  Redis operations/request = 0')
    console.log('  Object storage operations/request = 0')
}

main()
