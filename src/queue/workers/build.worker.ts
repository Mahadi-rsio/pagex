import { Worker } from 'bullmq'
import { promises as fs } from 'fs'
import { existsSync } from 'fs'
import * as path from 'path'
import { spawn } from 'child_process'
import { eq } from 'drizzle-orm'
import { lookup } from 'mime-types'
import { connection } from '../../infrastructure/cache/redis.js'
import { db } from '../../infrastructure/db/db.js'
import { builds } from '../../infrastructure/db/schema.js'
import { deleteSiteObjects, minioClient, SHARED_BUCKET } from '../../infrastructure/storage/minio.js'
import { CLOUDISY_CLOUD_BUILDS_QUEUE, type CloudBuildJob } from '../jobs/build.queue.js'

async function getFilesRecursively(dir: string): Promise<string[]> {
    const dirents = await fs.readdir(dir, { withFileTypes: true });
    const files = await Promise.all(dirents.map((dirent) => {
        const res = path.resolve(dir, dirent.name);
        return dirent.isDirectory() ? getFilesRecursively(res) : res;
    }));
    return files.flat();
}

const worker = new Worker<CloudBuildJob>(
    CLOUDISY_CLOUD_BUILDS_QUEUE,
    async (job) => {
        const { buildId, pageId, tenantId, siteId, repoUrl, gitProvider, gitToken, framework, buildCommand, outputDir: jobOutputDir, envVars } = job.data;
        const jobId = job.id;
        const cloneDir = `/tmp/cloudisy-builds/${jobId}`;

        console.log(`Starting build job ${jobId} for buildId: ${buildId}...`);

        const startTime = Date.now();
        try {
            // Step 1 (10%) — Clone repo
            await job.updateProgress(10);
            await job.log("Step 1: Cloning repository...");

            const authedUrl = repoUrl.replace(/^https:\/\//, `https://oauth2:${gitToken}@`);

            await fs.mkdir('/tmp/cloudisy-builds', { recursive: true });
            await fs.rm(cloneDir, { recursive: true, force: true }).catch(() => {});

            await new Promise<void>((resolve, reject) => {
                const p = spawn('git', ['clone', '--depth=1', authedUrl, cloneDir]);
                p.on('close', (code) => {
                    if (code === 0) resolve();
                    else reject(new Error(`Git clone failed with code ${code}`));
                });
                p.on('error', reject);
            });

            // Step 2 (35%) — Build with Docker
            await job.updateProgress(35);
            await job.log("Step 2: Building project with Docker...");

            const containerName = `cloudisy-build-${jobId}`;
            const dockerArgs = [
                'run', '--rm',
                '--name', containerName,
                '--memory', '1g',
                '-v', `${cloneDir}:/app`,
                '-w', '/app',
            ];
            if (envVars) {
                for (const [key, value] of Object.entries(envVars)) {
                    dockerArgs.push('--env', `${key}=${value}`);
                }
            }
            dockerArgs.push(
                'cloudisy-build-env:latest',
                'sh', '-c',
                `(pnpm install --frozen-lockfile 2>/dev/null || pnpm install) && ${buildCommand}`
            );

            await new Promise<void>((resolve, reject) => {
                const p = spawn('docker', dockerArgs);
                let stdoutBuf = '';
                let stderrBuf = '';

                // Start stats collection interval (every 2 seconds)
                const statsInterval = setInterval(() => {
                    const statsProcess = spawn('docker', ['stats', '--no-stream', '--format', 'RAM: {{.MemUsage}} | Net I/O: {{.NetIO}}', containerName]);
                    let output = '';
                    statsProcess.stdout?.on('data', (data) => {
                        output += data.toString();
                    });
                    statsProcess.on('close', (code) => {
                        if (code === 0 && output.trim()) {
                            job.log(`[Stats] ${output.trim()}`);
                        }
                    });
                }, 2000);

                const cleanup = () => {
                    clearInterval(statsInterval);
                };

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
                    cleanup();
                    if (stdoutBuf) job.log(stdoutBuf);
                    if (stderrBuf) job.log(stderrBuf);
                    if (code === 0) resolve();
                    else reject(new Error(`Docker build failed with code ${code}`));
                });
                p.on('error', (err) => {
                    cleanup();
                    reject(err);
                });
            });

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

            // Step 4 (90%) — Upload to MinIO
            await job.updateProgress(90);
            await job.log("Step 4: Uploading build outputs to MinIO...");

            await deleteSiteObjects(siteId);

            const files = await getFilesRecursively(detectedDir);
            for (const file of files) {
                const relativePath = path.relative(detectedDir, file);
                const s3Key = `${siteId}/${relativePath}`;
                const fileBuffer = await fs.readFile(file);
                await minioClient.putObject(SHARED_BUCKET, s3Key, fileBuffer, fileBuffer.length, {
                    'Content-Type': lookup(file) || 'application/octet-stream'
                });
            }

            // Step 5 (100%) — Update DB + Cleanup
            await job.updateProgress(100);
            await job.log("Step 5: Finalizing build...");

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
            
            await db.update(builds)
                .set({ status: 'failed', error: err?.message || 'Unknown error' })
                .where(eq(builds.id, buildId));

            throw err;
        }
    },
    { connection, concurrency: 2 }
);

worker.on('completed', () => {
    console.log("Build job completed successfully.");
});

worker.on('failed', (job, err) => {
    console.error(`Build job ${job?.id} failed:`, err);
});

console.log('Build worker running...');
