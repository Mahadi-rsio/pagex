import type { NextConfig } from "next";

const nextConfig: NextConfig = {
    output: "standalone",
    env: {
        PUBLIC_URL: process.env.PUBLIC_URL || "",
    },
};

export default nextConfig;
