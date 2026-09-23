import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { logger } from "./logger.js";

/**
 * Run the build script from package.json with spinner and full logs
 */
export function runBuild(projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const pkgPath = path.join(projectPath, 'package.json');
        if (!fs.existsSync(pkgPath)) return reject(new Error('package.json not found'));

        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        const buildCommand = pkg.scripts?.build;

        if (!buildCommand) return reject(new Error('No "build" script found in package.json'));

        // Run npm build safely with inherit stdio for real-time output
        const child = spawn('npm', ['run', 'build'], {
            cwd: projectPath,
            stdio: 'inherit', // pipes stdout/stderr to terminal directly
        });

        child.on('exit', (code) => {


            if (code === 0) {
                logger.success("Build complete – deploying for production");
                resolve();
            } else {
                logger.error(`Build failed with code ${code}`);
                reject(new Error(`Build failed with code ${code}`));
            }
        });
    });
}
