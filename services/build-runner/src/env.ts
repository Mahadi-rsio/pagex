/**
 * Environment construction for untrusted build scripts.
 *
 * Build scripts run with a minimal, fixed environment: no machine token, no job
 * token, no console credentials, no cloud provider keys. Only the runtime
 * essentials and an explicit, opt-in allowlist (`BUILD_PASSTHROUGH_ENV`) cross
 * the boundary.
 */

const BASE_ALLOWLIST = [
    "PATH",
    "HOME",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "TEMP",
    "TMP",
    "SHELL",
    "TERM",
    "USER",
];

export interface BuildEnvOptions {
    base?: NodeJS.ProcessEnv;
    passThrough?: string[];
    /**
     * Value for NODE_ENV. Pass `undefined` to omit NODE_ENV entirely so npm /
     * pnpm install all dependencies (including devDependencies) during the
     * install step. Defaults to "production" for build/deploy steps.
     */
    nodeEnv?: string | null;
    /**
     * Value for NODE_OPTIONS. Used to enable the OpenSSL legacy provider when
     * retrying a build for legacy webpack-4 (CRA) projects on Node >= 17.
     */
    nodeOptions?: string;
}

/**
 * Environment handed to install/build commands. Deliberately omits every
 * PageX/cloud secret.
 */
export function buildScriptEnv(
    options: BuildEnvOptions = {},
): Record<string, string> {
    const base = options.base ?? process.env;
    const env: Record<string, string> = {};

    for (const key of [...BASE_ALLOWLIST, ...(options.passThrough ?? [])]) {
        const value = base[key];
        if (typeof value === "string") env[key] = value;
    }

    env.CI = "true";
    if (options.nodeEnv !== null) {
        env.NODE_ENV = options.nodeEnv ?? "production";
    }
    if (options.nodeOptions) {
        env.NODE_OPTIONS = options.nodeOptions;
    }
    // Never let npm/pnpm reach a user-level config that might carry a token.
    env.NPM_CONFIG_USERCONFIG = "/dev/null";
    env.npm_config_userconfig = "/dev/null";
    // Hosting platforms do not hard-fail on `engines` mismatches (Vercel warns
    // and proceeds). Repo-level `.npmrc` `engine-strict=true` is lower
    // precedence than env, so these override it. Install code still runs on the
    // image Node; this only removes the version gate.
    env.npm_config_engine_strict = "false";
    env.NPM_CONFIG_ENGINE_STRICT = "false";
    env.YARN_IGNORE_ENGINES = "1";
    return env;
}

/**
 * Environment for the deploy step. This is the ONLY place the job token is
 * exposed, and only to the PageX CLI child process — never to the project's own
 * build scripts.
 */
export function deployEnv(options: {
    base?: NodeJS.ProcessEnv;
    consoleUrl: string;
    jobToken: string;
}): Record<string, string> {
    const base = options.base ?? process.env;
    const env = buildScriptEnv({ base, passThrough: [] });
    env.PAGEX_API_URL = options.consoleUrl;
    env.PAGEX_AUTH_URL = options.consoleUrl;
    env.PAGEX_JOB_TOKEN = options.jobToken;
    return env;
}
