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

/**
 * Ordered install attempts for a package manager, strictest first. The runner
 * tries each in turn and stops at the first success. Strict/"frozen" installs
 * keep clean lockfiles reproducible; the later tiers exist because real-world
 * public repos frequently drift and Vercel/Netlify tolerate that instead of
 * failing the deploy:
 *
 *   - lockfile out of sync with package.json
 *   - npm 7+ peer-dependency conflicts (`ERESOLVE`) → `--legacy-peer-deps`
 *   - packages declaring `engines` the runtime does not satisfy
 */
export function installCommandCandidates(pm: PackageManager): string[][] {
    switch (pm) {
        case "pnpm":
            return [
                ["pnpm", "install", "--frozen-lockfile"],
                ["pnpm", "install", "--no-frozen-lockfile"],
            ];
        case "yarn":
            return [
                ["yarn", "install", "--frozen-lockfile"],
                ["yarn", "install"],
                ["yarn", "install", "--ignore-engines"],
            ];
        case "bun":
            return [
                ["bun", "install", "--frozen-lockfile"],
                ["bun", "install"],
            ];
        case "npm":
            return [
                ["npm", "ci"],
                ["npm", "install", "--no-audit", "--no-fund"],
                [
                    "npm",
                    "install",
                    "--no-audit",
                    "--no-fund",
                    "--legacy-peer-deps",
                ],
            ];
    }
}

/** The strict primary install attempt for a package manager. */
export function installCommandFor(pm: PackageManager): string[] {
    return installCommandCandidates(pm)[0]!;
}

/**
 * The first relaxed fallback attempt (lockfile drift). Kept for callers that
 * only want a single fallback.
 */
export function fallbackInstallCommandFor(pm: PackageManager): string[] {
    const candidates = installCommandCandidates(pm);
    return candidates[1] ?? candidates[0]!;
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
        gatsby: "public",
        docusaurus: "build",
        vitepress: ".vitepress/dist",
        vuepress: ".vuepress/dist",
        eleventy: "_site",
        hexo: "public",
        hugo: "public",
        jekyll: "_site",
        gridsome: "dist",
        vue: "dist",
        angular: "dist",
        ember: "dist",
        preact: "build",
        parcel: "dist",
        "solid-start": ".output/public",
        remix: "build/client",
    };
    if (known[framework]) return known[framework];
    for (const candidate of [
        "dist",
        "build",
        "out",
        "public",
        ".output/public",
        "build/client",
        ".vitepress/dist",
        ".vuepress/dist",
        "_site",
    ]) {
        if (hasDir(candidate)) return candidate;
    }
    return "dist";
}

export function detectFramework(dir: string): string {
    const pkg = readPackageJson(dir);
    const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
    if (deps.next) return "next";
    if (deps["@sveltejs/kit"]) return "svelte-kit";
    if (deps["@solidjs/start"]) return "solid-start";
    if (deps.nuxt || deps["nuxt3"]) return "nuxt";
    if (deps["@remix-run/dev"] || deps["@remix-run/react"]) return "remix";
    if (deps.astro) return "astro";
    if (deps["@docusaurus/core"]) return "docusaurus";
    if (deps.vitepress) return "vitepress";
    if (deps.vuepress) return "vuepress";
    if (deps["@11ty/eleventy"]) return "eleventy";
    if (deps.hexo) return "hexo";
    if (deps.gatsby) return "gatsby";
    if (deps.gridsome) return "gridsome";
    if (deps["@vue/cli-service"]) return "vue";
    if (deps["react-scripts"]) return "cra";
    if (deps["preact-cli"]) return "preact";
    if (deps["@parcel/core"] || deps.parcel) return "parcel";
    if (deps["ember-source"]) return "ember";
    if (deps["@angular/core"]) return "angular";
    if (deps.vite) return "vite";
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

    // Best-effort submodule checkout. Many static-site repos vendor themes or
    // content as submodules; a missing submodule would otherwise fail the build
    // with confusing "file not found" errors. Failure here is non-fatal because
    // repos without submodules are the common case.
    await run(
        "git",
        [
            "-C",
            dir,
            "submodule",
            "update",
            "--init",
            "--recursive",
            "--depth",
            "1",
        ],
        { cwd: dir, env, timeoutMs, onOutput: (c) => onOutput(c) },
    );
}
