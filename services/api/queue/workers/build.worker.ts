import { Worker, Job } from 'bullmq'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { eq, and, desc } from 'drizzle-orm'
import { connection, redis } from '../../infrastructure/cache/redis.js'
import { db } from '../../infrastructure/db/db.js'
import { builds, deployments, sites } from '../../infrastructure/db/schema.js'
import { CLOUDISY_CLOUD_BUILDS_QUEUE, type CloudBuildJob, buildDlqQueue, classifyBuildError, moveToDLQ } from '../jobs/build.queue.js'
import { deployFromLocalDirectory } from '../../services/deploy.service.js'
import { validateOutputDir } from '../../utils/deployment-validator.js'

/**
 * Platform secrets/env prefix blocklist. User-supplied build env vars whose names
 * collide with, or could shadow, PageX's own infrastructure config are dropped so a
 * tenant cannot exfiltrate or impersonate internal credentials inside the build
 * container (which runs with --network none but may still reach a leaked socket).
 */
const BLOCKED_ENV_PREFIXES = [
    'MINIO_',
    'S3_',
    'REDIS_',
    'DATABASE_',
    'DIRECT_',
    'POSTGRES_',
    'BETTER_AUTH_',
    'AUTH_JWKS_',
    'EXPRESS_',
    'NEXT_',
]

/**
 * Filter a raw env map down to a safe allowlist. Returns only user-declared keys
 * that do not match a blocked platform prefix and are non-empty strings.
 */
function sanitizeBuildEnvVars(envVars?: Record<string, string>): Record<string, string> {
    const safe: Record<string, string> = {}
    if (!envVars) return safe
    for (const [key, value] of Object.entries(envVars)) {
        if (!key || typeof value !== 'string' || value.length === 0) continue
        const upper = key.toUpperCase()
        if (BLOCKED_ENV_PREFIXES.some((prefix) => upper.startsWith(prefix))) continue
        safe[key] = value
    }
    return safe
}

/**
 * Per-tenant build concurrency guard (BullMQ v5 has no job groups, so we enforce
 * fairness ourselves with a Redis-backed counter). No single tenant may run more
 * than BUILD_MAX_CONCURRENT_PER_TENANT build containers at once, preventing one
 * tenant from exhausting the whole build pool or the Docker daemon.
 */
const BUILD_MAX_CONCURRENT_PER_TENANT = Number(process.env.BUILD_MAX_CONCURRENT_PER_TENANT || 2)
const TENANT_BUILD_SEM_PREFIX = 'build:sem:'

async function acquireTenantSlot(tenantId: string): Promise<void> {
    const key = `${TENANT_BUILD_SEM_PREFIX}${tenantId}`
    const lockAcquired = await redis.eval(
        `
        local key = KEYS[1]
        local limit = tonumber(ARGV[1])
        local lease = tonumber(ARGV[2])
        local cur = tonumber(redis.call('GET', key) or '0')
        if cur >= limit then
            return 0
        end
        redis.call('INCR', key)
        redis.call('EXPIRE', key, lease)
        return 1
        `,
        1,
        key,
        String(BUILD_MAX_CONCURRENT_PER_TENANT),
        String(60 * 5) // 5-minute lease; released early on success/failure
    ) as number

    if (lockAcquired !== 1) {
        throw new Error('Tenant build concurrency limit reached; please retry shortly')
    }
}

async function releaseTenantSlot(tenantId: string): Promise<void> {
    const key = `${TENANT_BUILD_SEM_PREFIX}${tenantId}`
    try {
        await redis.decr(key)
    } catch {
        // best-effort; a leftover under-count is bounded by the 5-minute lease
    }
}

/**
 * Hardening flags applied to every per-build `docker run`.
 * Rationale:
 *  - --cpus/--memory     : hard CPU + memory ceiling (no swap ballooning)
 *  - --pids-limit        : stop fork bombs
 *  - --cap-drop ALL      : no privilege escalation / raw sockets / mount etc.
 *  - --security-opt no-new-privileges : no setuid privilege gain
 *  - --security-opt seccomp=<profile> : drop risky syscalls (ptrace, mount, ...)
 *  - --tmpfs /tmp        : scratch space in /tmp
 *  - Network & host isolation: Handled by docker-dind sandbox (containers run on dind's
 *                              bridge with internet for npm/pnpm installs, but isolated from host)
 */
const BUILD_SECCOMP_PROFILE = process.env.BUILD_SECCOMP_PROFILE || '/etc/seccomp/build.json'
const BUILD_RUN_USER = process.env.BUILD_RUN_USER || '10001:10001'
const BUILD_MEMORY_LIMIT = process.env.BUILD_MEMORY_LIMIT || '1g'
const BUILD_CPUS = process.env.BUILD_CPUS || '1.0'
// In the isolated dind sandbox the build-env image is loaded locally, so we
// must NOT force a registry pull by default (there is no registry auth inside
// dind). Set BUILD_PULL_ALWAYS=1 to switch back to --pull always.
const BUILD_PULL_ALWAYS = process.env.BUILD_PULL_ALWAYS === '1'

function buildDockerCreateArgs(opts: {
    containerName: string;
    envVars: Record<string, string>;
    image: string;
    command: string;
}): string[] {
    const args = [
        'create',
        ...(BUILD_PULL_ALWAYS ? ['--pull', 'always'] : []),
        '--name', opts.containerName,
        '--cpus', BUILD_CPUS,
        '--memory', BUILD_MEMORY_LIMIT,
        '--memory-swap', BUILD_MEMORY_LIMIT,
        '--pids-limit', '256',
        '--cap-drop', 'ALL',
        '--security-opt', 'no-new-privileges',
        '--security-opt', `seccomp=${BUILD_SECCOMP_PROFILE}`,
        '--tmpfs', '/tmp:rw,exec,nosuid,mode=1777',
        '-w', '/app',
    ];
    for (const [key, value] of Object.entries(opts.envVars)) {
        args.push('--env', `${key}=${value}`);
    }
    args.push(
        opts.image,
        'sh', '-c',
        opts.command
    );
    return args;
}

async function chmodRecursive(dir: string, mode: number): Promise<void> {
    await fs.chmod(dir, mode).catch(() => {});
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            await chmodRecursive(fullPath, mode);
        } else {
            await fs.chmod(fullPath, mode).catch(() => {});
        }
    }
}

async function getFilesRecursively(dir: string): Promise<string[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFilesRecursively(res) : res;
    }));
    return files.flat();
}

/** Pick install command from packageManager field or lockfiles. */
async function resolveInstallCommand(cloneDir: string): Promise<string> {
    const has = (file: string) => existsSync(path.join(cloneDir, file));

    try {
        const pkgRaw = await fs.readFile(path.join(cloneDir, 'package.json'), 'utf8');
        const pkg = JSON.parse(pkgRaw) as { packageManager?: string };
        const pm = pkg.packageManager?.split('@')[0]?.toLowerCase();
        if (pm === 'npm') return '(npm ci 2>/dev/null || npm install)';
        if (pm === 'yarn') return '(yarn install --frozen-lockfile 2>/dev/null || yarn install)';
        if (pm === 'pnpm') return '(pnpm install --frozen-lockfile 2>/dev/null || pnpm install)';
        if (pm === 'bun') return 'bun install';
    } catch {
        // fall through to lockfile detection
    }

    // Prefer npm when a package-lock exists (avoids broken pnpm-workspace.yaml
    // files that only contain allowBuilds / ignoredBuiltDependencies).
    if (has('package-lock.json')) return '(npm ci 2>/dev/null || npm install)';
    if (has('yarn.lock')) return '(yarn install --frozen-lockfile 2>/dev/null || yarn install)';
    if (has('pnpm-lock.yaml')) return '(pnpm install --frozen-lockfile 2>/dev/null || pnpm install)';
    if (has('bun.lockb') || has('bun.lock')) return 'bun install';
    if (has('package.json')) return '(npm install || pnpm install)';

    return 'true';
}

const worker = new Worker<CloudBuildJob>(
    CLOUDISY_CLOUD_BUILDS_QUEUE,
    async (job: Job<CloudBuildJob>) => {
        const { buildId, pageId, tenantId, siteId, repoUrl, gitProvider, gitToken, framework, buildCommand, outputDir: jobOutputDir, envVars } = job.data;
        const jobId = job.id ?? 'unknown';
        const cloneDir = `/tmp/cloudisy-builds/${jobId}`;

        console.log(`Starting build job ${jobId} for buildId: ${buildId}...`);

        const startTime = Date.now();
        let slotAcquired = false;
        try {
            // Step 1 (10%) — Clone repo
            await job.updateProgress(10);
            await job.log("Step 1: Cloning repository...");

            const cloneUrl = gitToken
                ? repoUrl.replace(/^https:\/\//, `https://oauth2:${gitToken}@`)
                : repoUrl;

            await fs.mkdir('/tmp/cloudisy-builds', { recursive: true });
            await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});

            await new Promise<void>((resolve, reject) => {
                const p = spawn('git', ['clone', '--depth=1', cloneUrl, cloneDir]);
                p.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Git clone failed with code ${code}`));
                });
                p.on('error', reject);
            });

            // Strip the embedded oauth2 token out of the cloned repo's git config
            // before the directory is bind-mounted into the build container. If it
            // stays, any malicious build script can read /app/.git/config and exfiltrate
            // the tenant's git credential.
            try {
                await new Promise<void>((resolve, reject) => {
                    const p = spawn('git', ['-C', cloneDir, 'remote', 'set-url', 'origin', repoUrl]);
                    p.on('close', (code) => {
                        if (code === 0) resolve();
                        else resolve(); // non-fatal: clone itself succeeded
                    });
                    p.on('error', () => resolve()); // non-fatal
                });
            } catch {
                // non-fatal — never fail a successful clone over token scrubbing
            }

            // Step 2 (35%) — Build with Docker
            await job.updateProgress(35);
            await job.log("Step 2: Building project with Docker...");

            const installCommand = await resolveInstallCommand(cloneDir);
            await job.log(`Using install: ${installCommand}`);

            const containerName = `cloudisy-build-${jobId}`;

            // Only forward user-declared, non-blocked env vars into the build container.
            const safeEnv = sanitizeBuildEnvVars(envVars);
            const droppedCount = envVars ? Object.keys(envVars).length - Object.keys(safeEnv).length : 0;
            if (droppedCount > 0) {
                await job.log(`Dropped ${droppedCount} env var(s) matching blocked platform prefixes`);
            }

            const dockerCreateArgs = buildDockerCreateArgs({
                containerName,
                envVars: safeEnv,
                image: process.env.BUILD_ENV_IMAGE || 'pagex-build-env:latest',
                command: `${installCommand} && ${buildCommand}`,
            });

            // Enforce the per-tenant concurrency ceiling before launching a container.
            await acquireTenantSlot(tenantId);
            slotAcquired = true;

            // 1. Create container in sandbox daemon
            await new Promise<void>((resolve, reject) => {
                const p = spawn('docker', dockerCreateArgs);
                p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`docker create failed with code ${code}`)));
                p.on('error', reject);
            });

            // 2. Copy cloned source repository into container /app/
            await new Promise<void>((resolve, reject) => {
                const p = spawn('docker', ['cp', `${cloneDir}/.`, `${containerName}:/app/`]);
                p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`docker cp in failed with code ${code}`)));
                p.on('error', reject);
            });

            // 3. Start container and stream build output logs
            await new Promise<void>((resolve, reject) => {
                const p = spawn('docker', ['start', '-a', containerName]);
                let stdoutBuf = '';
                let stderrBuf = '';

                const handleData = (data: Buffer, isError: boolean) => {
                    const str = data.toString();
                    const lines = str.split('\n');
                    if (lines.length > 0) {
                        for (let i = 0; i < lines.length - 1; i++) {
                            const line = lines[i];
                            if (line !== undefined) {
                                job.log(line);
                            }
                        }
                        const lastLine = lines[lines.length - 1];
                        if (lastLine !== undefined) {
                            if (isError) {
                                stderrBuf = lastLine;
                            } else {
                                stdoutBuf = lastLine;
                            }
                        }
                    }
                };

                p.stdout?.on('data', (data) => handleData(data, false));
                p.stderr?.on('data', (data) => handleData(data, true));

                p.on('close', (code) => {
                    if (stdoutBuf) job.log(stdoutBuf);
                    if (stderrBuf) job.log(stderrBuf);
                    if (code === 0) resolve();
                    else reject(new Error(`Docker build failed with code ${code}`));
                });
                p.on('error', (err) => {
                    reject(err);
                });
            });

            // 4. Copy build outputs back from container /app/ to cloneDir
            await new Promise<void>((resolve, reject) => {
                const p = spawn('docker', ['cp', `${containerName}:/app/.`, `${cloneDir}/`]);
                p.on('close', (code) => code === 0 ? resolve() : reject(new Error(`docker cp out failed with code ${code}`)));
                p.on('error', reject);
            });

            // 5. Remove temporary build container
            await new Promise<void>((resolve) => {
                const p = spawn('docker', ['rm', '-f', containerName]);
                p.on('close', () => resolve());
                p.on('error', () => resolve());
            });

            try {
                await releaseTenantSlot(tenantId);
            } catch {
                // best-effort
            }
            slotAcquired = false;

            // Step 3 (70%) — Detect output dir
            await job.updateProgress(70);
            await job.log("Step 3: Detecting output directory...");

            let detectedDir = '';
            if (jobOutputDir) {
                const target = path.join(cloneDir, jobOutputDir);
                if (existsSync(target)) {
                    detectedDir = target;
                } else {
                    throw new Error(`Configured output directory not found: ${jobOutputDir}`);
                }
            } else {
                const candidates = ['.next', 'dist', 'out', 'build', 'public'];
                for (const candidate of candidates) {
                    const target = path.join(cloneDir, candidate);
                    if (existsSync(target)) {
                        detectedDir = target;
                        break;
                    }
                }
                if (!detectedDir) {
                    throw new Error("Could not detect output directory");
                }
            }

            // Step 4 (90%) — Validate output + content-addressed blob deploy
            await job.updateProgress(90);
            await job.log("Step 4: Validating build output...");

            const validation = await validateOutputDir(detectedDir)
            if (!validation.valid) {
                await job.log(validation.error)
                await db.update(builds)
                    .set({ status: 'failed', error: validation.error, completed_at: new Date() })
                    .where(eq(builds.id, buildId))
                await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {})
                console.error(`Build job ${jobId} failed validation: ${validation.error}`)
                // Validation failure is permanent - don't retry
                const error = new Error(validation.error)
                ;(error as any).permanent = true
                throw error
            }

            await job.log("Step 4: Deploying build outputs via blob store...")

            const [site] = await db.select().from(sites).where(eq(sites.id, siteId)).limit(1)
            if (!site) {
                throw new Error(`Site not found: ${siteId}`)
            }

            const files = await getFilesRecursively(detectedDir)
            if (files.length === 0) {
                throw new Error(`No files found in output directory: ${detectedDir}`)
            }

            const result = await deployFromLocalDirectory({
                outputDir: detectedDir,
                files,
                pageId,
                tenantId,
                siteId,
                subdomain: site.subdomain,
                buildId,
                log: async (message) => {
                    await job.log(message)
                },
            })

            await job.log(
                `Deployed v${result.deployment?.version ?? '?'} — ` +
                `${result.fileCount} files (new blobs: ${result.filesDeployed}, reused: ${result.filesReused})`
            )
            if (result.summary) {
                await job.log(
                    `[Summary] ${result.summary.totalFiles} files · ${result.summary.totalSizeHuman} total · ` +
                    `text −${result.summary.sizeReducedHuman} (${result.summary.sizeReducedPercent}%) · ` +
                    `images ${result.summary.imagesOptimized} optimized (−${result.summary.imageSizeReducedHuman})`
                )
            }

            // Step 5 (100%) — Update DB + Cleanup
            await job.updateProgress(100);
            await job.log("Step 5: Finalizing build...")

            const durationSeconds = ((Date.now() - startTime) / 1000).toFixed(2);
            await job.log(`[Stats] Total Build Duration: ${durationSeconds}s`);

            await db.update(builds)
                .set({ status: 'completed', completed_at: new Date() })
                .where(eq(builds.id, buildId));

            await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});
            console.log(`Build job ${jobId} completed successfully.`);

        } catch (err: any) {
            console.error(`Build job ${jobId} failed:`, err);
            // Force stop the docker container if it is still running
            const killProcess = spawn('docker', ['kill', `cloudisy-build-${jobId}`]);
            killProcess.on('close', () => {
                console.log(`Forced container cloudisy-build-${jobId} to stop.`);
            });
            await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});

            // Always release the per-tenant slot on any failure path.
            if (slotAcquired) {
                try { await releaseTenantSlot(tenantId); } catch { /* best-effort */ }
                slotAcquired = false;
            }

            const errorMessage = err?.message || 'Unknown error'
            await db.update(builds)
                .set({ status: 'failed', error: errorMessage, completed_at: new Date() })
                .where(eq(builds.id, buildId));

            // Mark associated deployment as failed if it exists and is still pending
            const [pendingDep] = await db
                .select({ id: deployments.id })
                .from(deployments)
                .where(and(eq(deployments.build_id, buildId), eq(deployments.status, 'pending')))
                .orderBy(desc(deployments.created_at))
                .limit(1)

            if (pendingDep) {
                await db
                    .update(deployments)
                    .set({ status: 'failed' })
                    .where(eq(deployments.id, pendingDep.id))
            }

            // Classify error and handle retry logic
            const isPermanent = err?.permanent === true || classifyBuildError(err) === 'permanent'
            
            // If permanent error or max attempts reached, move to DLQ
            const attemptsMade = job.attemptsMade ?? 1
            const maxAttempts = job.opts?.attempts ?? 3
            
            if (isPermanent || attemptsMade >= maxAttempts) {
                console.log(`Build job ${jobId} failed permanently or max attempts reached, moving to DLQ`)
                await moveToDLQ({
                    id: jobId,
                    data: job.data,
                    attemptsMade,
                    failedReason: errorMessage,
                }, err)
                
                // Don't throw for permanent errors - let the job be marked as failed without retry
                if (isPermanent) {
                    // Return instead of throwing to prevent retry
                    return
                }
            }

            throw err;
        }
    },
    { connection, concurrency: 2 }
);

worker.on('completed', (job) => {
    console.log(`Build job ${job.id} completed successfully.`);
});

worker.on('failed', (job, err) => {
    console.error(`Build job ${job?.id} failed after all retries:`, err);
});

worker.on('error', (err) => {
    console.error('Build worker error:', err);
});

console.log('Build worker running...');