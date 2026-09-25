import type { NextConfig } from "next";
import fs from "node:fs";
import path from "node:path";

// Detect if running inside the monorepo root (host development / builds).
// Inside Docker (services/console alone), ../.. is / which is not the monorepo.
const possibleMonorepoRoot = path.join(__dirname, "../..");
const isMonorepo =
  fs.existsSync(path.join(possibleMonorepoRoot, "pnpm-workspace.yaml")) ||
  fs.existsSync(path.join(possibleMonorepoRoot, "pnpm-lock.yaml"));

const monorepoRoot = isMonorepo ? possibleMonorepoRoot : undefined;

const nextConfig: NextConfig = {
  // Vercel deploys its own serverless output; standalone is for Docker/Node hosts.
  output: process.env.VERCEL ? undefined : "standalone",
  ...(monorepoRoot
    ? {
        outputFileTracingRoot: monorepoRoot,
        turbopack: {
          root: monorepoRoot,
        },
      }
    : {}),
  env: {
    PUBLIC_URL: process.env.PUBLIC_URL || "",
  },
};

export default nextConfig;

