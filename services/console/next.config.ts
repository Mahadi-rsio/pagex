import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// Detect if running inside the monorepo root (host development / builds).
// Inside Docker (services/console alone), ../.. is / which is not the monorepo.
const possibleMonorepoRoot = path.join(__dirname, "../..");
const isMonorepo =
    fs.existsSync(path.join(possibleMonorepoRoot, "pnpm-workspace.yaml")) ||
    fs.existsSync(path.join(possibleMonorepoRoot, "pnpm-lock.yaml"));

const monorepoRoot = isMonorepo ? possibleMonorepoRoot : undefined;

const HYPERDRIVE_LOCAL_ENV =
    "CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE";

function isUsablePostgresUrl(value: string | undefined): boolean {
    if (!value) return false;
    try {
        const url = new URL(value);
        return url.protocol === "postgres:" || url.protocol === "postgresql:";
    } catch {
        return false;
    }
}

function parseEnvFile(filePath: string): Record<string, string> {
    if (!fs.existsSync(filePath)) return {};
    const out: Record<string, string> = {};
    for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
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
        out[key] = value;
    }
    return out;
}

/**
 * Wrangler/OpenNext prefer process.env over `.dev.vars`. A shell placeholder
 * like YOUR_DEV_DATABASE_URL then crashes `initOpenNextCloudflareForDev`
 * during `next build`. Replace invalid Hyperdrive URLs from local files.
 */
function ensureHyperdriveLocalConnectionString(): void {
    if (isUsablePostgresUrl(process.env[HYPERDRIVE_LOCAL_ENV])) return;

    const devVars = parseEnvFile(path.join(__dirname, ".dev.vars"));
    const dotenv = parseEnvFile(path.join(__dirname, ".env"));
    const candidates = [
        devVars[HYPERDRIVE_LOCAL_ENV],
        dotenv[HYPERDRIVE_LOCAL_ENV],
        process.env.DATABASE_URL,
        devVars.DATABASE_URL,
        dotenv.DATABASE_URL,
    ];

    for (const candidate of candidates) {
        if (isUsablePostgresUrl(candidate)) {
            process.env[HYPERDRIVE_LOCAL_ENV] = candidate;
            return;
        }
    }

    // Drop the bad value so Wrangler can fall back / warn instead of throwing.
    Reflect.deleteProperty(process.env, HYPERDRIVE_LOCAL_ENV);
}

ensureHyperdriveLocalConnectionString();

const LOOPBACK_PUBLIC_URL_RE =
    /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\/?$/i;

/**
 * `env` values are inlined into the bundle at build time. `.dev.vars` carries a
 * local-preview `PUBLIC_URL` (e.g. the Wrangler port), so blindly forwarding it
 * bakes `http://127.0.0.1:8787` into a production Worker and hands that origin
 * to the CLI during deploys. Only forward a non-loopback absolute URL; leave it
 * empty otherwise so runtime code falls back to the request/window origin.
 */
function resolveInlinePublicUrl(): string {
    const value = process.env.PUBLIC_URL?.trim();
    if (!value || !/^https?:\/\//i.test(value)) return "";
    if (LOOPBACK_PUBLIC_URL_RE.test(value)) return "";
    return value;
}

const nextConfig: NextConfig = {
    // Cloudflare OpenNext Workers — do not emit Next.js standalone output.
    ...(monorepoRoot
        ? {
              outputFileTracingRoot: monorepoRoot,
              turbopack: {
                  root: monorepoRoot,
              },
          }
        : {}),
    // pg loads pg-cloudflare only under the workerd condition (runtime check).
    // @vercel/nft cannot see that path, so force-include the workerd builds
    // or OpenNext's esbuild step fails with "Could not resolve pg-cloudflare".
    // See: https://github.com/opennextjs/opennextjs-cloudflare/issues/1214
    outputFileTracingIncludes: {
        "/**": [
            "./node_modules/pg-cloudflare/dist/**/*",
            "./node_modules/pg-cloudflare/esm/**/*",
        ],
    },
    serverExternalPackages: ["pg", "pg-cloudflare"],
    env: {
        PUBLIC_URL: resolveInlinePublicUrl(),
    },
};

export default nextConfig;

import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

initOpenNextCloudflareForDev();
