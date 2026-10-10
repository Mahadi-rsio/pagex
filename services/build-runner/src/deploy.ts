import fs from "node:fs";
import { deployEnv } from "./env.js";
import { run } from "./process.js";

export interface DeployInvocation {
    cliEntry: string;
    consoleUrl: string;
    jobToken: string;
    projectId: string;
    outputDir: string;
    cwd: string;
    timeoutMs: number;
    onOutput: (chunk: string) => void;
}

export interface DeployOutcome {
    deploymentId: string;
    url: string | null;
}

const RESULT_PREFIX = "PAGEX_RESULT ";

/** Extract the machine result line the CLI prints with `--json`. */
export function parseDeployResult(stdout: string): DeployOutcome | null {
    const lines = stdout.split(/\r?\n/);
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]?.trim();
        if (!line?.startsWith(RESULT_PREFIX)) continue;
        try {
            const parsed = JSON.parse(line.slice(RESULT_PREFIX.length)) as {
                success?: boolean;
                deploymentId?: string | null;
                url?: string | null;
            };
            if (parsed.success && parsed.deploymentId) {
                return { deploymentId: parsed.deploymentId, url: parsed.url ?? null };
            }
            return null;
        } catch {
            return null;
        }
    }
    return null;
}

function buildChildEnv(inv: DeployInvocation): Record<string, string> {
    const env = deployEnv({
        consoleUrl: inv.consoleUrl,
        jobToken: inv.jobToken,
    });
    if (process.env.PAGEX_CLI_CONFIG_DIR) {
        env.PAGEX_CLI_CONFIG_DIR = process.env.PAGEX_CLI_CONFIG_DIR;
    }
    return env;
}

/**
 * Deploy already-built output through the PageX CLI in build-machine mode.
 * The CLI authenticates with the job token and assets land in R2 exactly as a
 * local deploy does — no separate upload path.
 */
export async function runCliDeploy(inv: DeployInvocation): Promise<DeployOutcome> {
    const isNodeEntry =
        inv.cliEntry.endsWith(".js") ||
        inv.cliEntry.endsWith(".mjs") ||
        inv.cliEntry.endsWith(".cjs") ||
        (fs.existsSync(inv.cliEntry) && fs.statSync(inv.cliEntry).isFile());

    const args = isNodeEntry
        ? [inv.cliEntry, "deploy", "--project", inv.projectId, "--dir", inv.outputDir, "--json"]
        : ["deploy", "--project", inv.projectId, "--dir", inv.outputDir, "--json"];

    const command = isNodeEntry ? process.execPath : inv.cliEntry;

    let captured = "";
    const res = await run(command, args, {
        cwd: inv.cwd,
        env: buildChildEnv(inv),
        timeoutMs: inv.timeoutMs,
        onOutput: (chunk) => {
            captured += chunk;
            inv.onOutput(chunk);
        },
    });

    if (res.timedOut) throw new Error("Deploy step timed out");
    if (res.code !== 0) throw new Error(`Deploy CLI exited with code ${res.code}`);

    const outcome = parseDeployResult(captured);
    if (!outcome) throw new Error("Deploy CLI did not report a deployment id");
    return outcome;
}
