#!/usr/bin/env node
/**
 * Load `.dev.vars` into process.env, then spawn the remaining CLI args.
 * Needed so `opennextjs-cloudflare build` / preview / deploy can satisfy
 * Hyperdrive's local connection-string check during `next build`.
 *
 * Existing process.env values win unless they are unusable placeholders
 * (e.g. YOUR_DEV_DATABASE_URL) — those are overwritten from `.dev.vars`.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const consoleRoot = path.resolve(scriptsDir, "..");
const varsPath = path.join(consoleRoot, ".dev.vars");

function isUsablePostgresUrl(value) {
    if (!value || typeof value !== "string") return false;
    try {
        const url = new URL(value);
        return url.protocol === "postgres:" || url.protocol === "postgresql:";
    } catch {
        return false;
    }
}

function shouldOverride(key, existing, incoming) {
    if (existing === undefined || existing === "") return true;
    if (
        key === "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE" ||
        key === "DATABASE_URL"
    ) {
        return !isUsablePostgresUrl(existing) && isUsablePostgresUrl(incoming);
    }
    return false;
}

if (fs.existsSync(varsPath)) {
    const text = fs.readFileSync(varsPath, "utf8");
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq <= 0) continue;
        const key = trimmed.slice(0, eq).trim();
        let value = trimmed.slice(eq + 1).trim();
        if (
            (value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))
        ) {
            value = value.slice(1, -1);
        }
        if (shouldOverride(key, process.env[key], value)) {
            process.env[key] = value;
        }
    }
}

const hyperdriveKey =
    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";
if (
    !isUsablePostgresUrl(process.env[hyperdriveKey]) &&
    isUsablePostgresUrl(process.env.DATABASE_URL)
) {
    process.env[hyperdriveKey] = process.env.DATABASE_URL;
}

const [cmd, ...args] = process.argv.slice(2);
if (!cmd) {
    console.error("usage: with-dev-vars.mjs <command> [...args]");
    process.exit(1);
}

const child = spawn(cmd, args, {
    stdio: "inherit",
    env: process.env,
    shell: process.platform === "win32",
});

child.on("exit", (code, signal) => {
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
