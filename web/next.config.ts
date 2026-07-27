import type { NextConfig } from "next";

const isExport = process.env.BUILD_MODE === "export";

const nextConfig: NextConfig = {
    output: isExport ? "export" : "standalone",
    ...(isExport ? { trailingSlash: true, images: { unoptimized: true } } : {}),
    env: {
        PUBLIC_URL: process.env.PUBLIC_URL || "",
    },
};

export default nextConfig;
