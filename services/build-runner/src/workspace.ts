import fs from "node:fs";
import path from "node:path";
import { run } from "./process.js";

export type PackageManager = "pnpm" | "yarn" | "npm" | "bun";

export interface BuildPlan {
    packageManager: PackageManager;
    installCommand: string[];
    buildCommand: string[];
    outputDir: string;
    framework: string;
}

/** Pick a package manager from lockfiles, most specific first. */
export function detectPackageManager(dir: string): PackageManager {
    const has = (f: string) => fs.existsSync(path.join(dir, f));
    if (has("pnpm-lock.yaml")) return "pnpm";
    if (has("yarn.lock")) return "yarn";
    if (has("bun.lockb") || has("bun.lock")) return "bun";
    if (has("package-lock.json")) return "npm";
    return "npm";
}

export function installCommandFor(pm: PackageManager): string[] {
    switch (pm) {
        case "pnpm":
            return ["pnpm", "install", "--frozen-lockfile"];
        case "yarn":
            return ["yarn", "install", "--frozen-lockfile"];
        case "bun":
            return ["bun", "install", "--frozen-lockfile"];
        case "npm":
            return ["npm", "ci"];
    }
}

/**
 * A less-strict install fallback used when the frozen/`ci` install fails
 * because a repo's lockfile is out of sync with its package.json. Real-world
 * public repos often drift, and Vercel/Netlify tolerate this by allowing the
 * install to update the lockfile. We only fall back after the strict attempt
 * fails, so clean lockfiles stay reproducible.
 */
export function fallbackInstallCommandFor(pm: PackageManager): string[] {
    switch (pm) {
        case "pnpm":
            return ["pnpm", "install", "--no-frozen-lockfile"];
        case "yarn":
            return ["yarn", "install"];
        case "bun":
            return ["bun", "install"];
        case "npm":
            return ["npm", "install"];
    }
}

function readPackageJson(
    dir: string,
): { scripts?: Record<string, string>; dependencies?: Record<string, string>; devDependencies?: Record<string, string> } | null {
    const p = path.join(dir, "package.json");
    if (!fs.existsSync(p)) return null;
    try {
        return JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
        return null;
    }
}

/** Best-effort static-output directory for a framework (v1 defaults). */
export function detectOutputDir(
    dir: string,
    framework: string,
): string {
    const hasDir = (d: string) => fs.existsSync(path.join(dir, d));
    const known: Record<string, string> = {
        vite: "dist",
        astro: "dist",
        "create-react-app": "build",
        cra: "build",
        "svelte-kit": "build",
        svelte: "build",
        nuxt: ".output/public",
        next: "out",
    };
    if (known[framework]) return known[framework];
    for (const candidate of ["dist", "build", "out", "public", ".output/public"]) {
        if (hasDir(candidate)) return candidate;
    }
    return "dist";
}

export function detectFramework(dir: string): string {
    const pkg = readPackageJson(dir);
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    if (deps.next) return "next";
    if (deps["@sveltejs/kit"]) return "svelte-kit";
    if (deps.nuxt || deps["nuxt3"]) return "nuxt";
    if (deps.astro) return "astro";
    if (deps.vite) return "vite";
    if (deps["react-scripts"]) return "cra";
    if (deps["@angular/core"]) return "angular";
    return "static";
}

export interface ResolvePlanInput {
    dir: string;
    framework: string | null;
    buildCommand: string | null;
    outputDir: string | null;
}

/**
 * Resolve the concrete install/build plan. Dashboard-provided `framework`,
 * `buildCommand`, and `outputDir` win; `"auto"`/null fall back to detection.
 */
export function resolveBuildPlan(input: ResolvePlanInput): BuildPlan {
    const pm = detectPackageManager(input.dir);
    const pkg = readPackageJson(input.dir);

    const framework =
        input.framework && input.framework !== "auto"
            ? input.framework
            : detectFramework(input.dir);

    let buildCommand: string[];
    if (input.buildCommand && input.buildCommand !== "auto") {
        buildCommand = ["/bin/sh", "-lc", input.buildCommand];
    } else if (pkg?.scripts?.build) {
        buildCommand = [pm, "run", "build"];
    } else {
        throw new Error("No build script found and no build command provided");
    }

    const outputDir = input.outputDir || detectOutputDir(input.dir, framework);

    return {
        packageManager: pm,
        installCommand: installCommandFor(pm),
        buildCommand,
        outputDir,
        framework,
    };
}

/**
 * Clone a repository and check out an exact commit. Pinning by SHA means a
 * branch that moves mid-build cannot change what is deployed. `--depth 1`
 * fetches just the commit; if the server refuses arbitrary-SHA shallow fetch we
 * fall back to a full fetch.
 */
export async function cloneRepo(params: {
    repoUrl: string;
    commitSha: string;
    branch: string;
    dir: string;
    env: Record<string, string>;
    timeoutMs: number;
    onOutput: (chunk: string) => void;
}): Promise<void> {
    const { repoUrl, commitSha, branch, dir, env, timeoutMs, onOutput } = params;
    fs.mkdirSync(dir, { recursive: true });

    const steps: Array<[string, string[]]> = [
        ["git", ["init", "-q", dir]],
        ["git", ["-C", dir, "remote", "add", "origin", repoUrl]],
        [
            "git",
            [
                "-C",
                dir,
                "fetch",
                "--depth",
                "1",
                "origin",
                commitSha,
            ],
        ],
    ];

    for (const [cmd, args] of steps) {
        const res = await run(cmd, args, {
            cwd: dir,
            env,
            timeoutMs,
            onOutput: (c) => onOutput(c),
        });
        if (res.code !== 0) {
            throw new Error(`git ${args[1] ?? args[0]} failed (code ${res.code})`);
        }
    }

    const checkout = await run(
        "git",
        ["-C", dir, "checkout", "-q", commitSha],
        { cwd: dir, env, timeoutMs, onOutput: (c) => onOutput(c) },
    );
    if (checkout.code !== 0) {
        // Shallow fetch of an arbitrary SHA is not universally supported.
        const fullFetch = await run(
            "git",
            ["-C", dir, "fetch", "--depth", "1", "origin", branch],
            { cwd: dir, env, timeoutMs, onOutput: (c) => onOutput(c) },
        );
        if (fullFetch.code !== 0) {
            throw new Error(`Unable to fetch ${branch}@${commitSha}`);
        }
        const retry = await run(
            "git",
            ["-C", dir, "checkout", "-q", commitSha],
            { cwd: dir, env, timeoutMs, onOutput: (c) => onOutput(c) },
        );
        if (retry.code !== 0) {
            throw new Error(`Unable to check out ${commitSha}`);
        }
    }
}
