import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { logger } from "./logger.js";

/** Lockfile → package manager mapping, checked in order of preference. */
const PM_BY_LOCKFILE: ReadonlyArray<readonly [string, string]> = [
    ["pnpm-lock.yaml", "pnpm"],
    ["bun.lockb", "bun"],
    ["bun.lock", "bun"],
    ["yarn.lock", "yarn"],
    ["package-lock.json", "npm"],
];

/** Detect the package manager in use from the project's lockfiles (default: npm). */
function detectPackageManager(projectPath: string): string {
    for (const [lockfile, pm] of PM_BY_LOCKFILE) {
        if (fs.existsSync(path.join(projectPath, lockfile))) return pm;
    }
    return "npm";
}

/**
 * Run the build script from package.json with spinner and full logs.
 * Uses the project's own package manager (pnpm/yarn/bun/npm).
 */
export function runBuild(projectPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const pkgPath = path.join(projectPath, "package.json");
        if (!fs.existsSync(pkgPath)) {
            reject(new Error("package.json not found"));
            return;
        }

        const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as {
            scripts?: Record<string, string>;
        };
        const buildCommand = pkg.scripts?.build;

        if (!buildCommand) {
            reject(new Error('No "build" script found in package.json'));
            return;
        }

        const packageManager = detectPackageManager(projectPath);
        logger.info(`Running build with ${packageManager}…`);

        // Run the project's build safely with inherit stdio for real-time output.
        // shell mode resolves the package-manager binary on all platforms (npm.cmd etc.)
        const child = spawn(packageManager, ["run", "build"], {
            cwd: projectPath,
            stdio: "inherit",
            shell: true,
        });

        child.on("error", (err) => {
            logger.error(`Failed to start ${packageManager}: ${err.message}`);
            reject(err);
        });

        child.on("exit", (code) => {
            if (code === 0) {
                logger.success("Build complete — deploying for production");
                resolve();
            } else {
                logger.error(`Build failed with code ${code ?? "unknown"}`);
                reject(new Error(`Build failed with code ${code ?? "unknown"}`));
            }
        });
    });
}
