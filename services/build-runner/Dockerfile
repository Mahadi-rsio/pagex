# syntax=docker/dockerfile:1
#
# PageX shared build machine image.
#
# Build from the REPOSITORY ROOT so the CLI can be included:
#   docker build -f services/build-runner/Dockerfile -t pagex-build-runner .
#
# The image contains: Node 24 + npm, pnpm/yarn (via corepack), bun, git, the
# built PageX CLI, and the runner. It holds NO PageX/cloud credentials — those
# are injected at runtime (BUILD_MACHINE_TOKEN, CONSOLE_URL) and never reach
# project builds.

# --- Stage 1: build the PageX CLI -----------------------------------------
FROM node:20-bookworm-slim AS cli-build
RUN corepack enable pnpm && corepack prepare pnpm@8.15.0 --activate
WORKDIR /build
COPY cli/package.json cli/pnpm-lock.yaml ./cli/
RUN cd cli && pnpm install --frozen-lockfile
COPY cli/tsconfig.json ./cli/tsconfig.json
COPY cli/src ./cli/src
RUN cd cli && pnpm build
# Drop dev dependencies from the shipped tree.
RUN cd cli && pnpm prune --prod

# --- Stage 2: build the runner --------------------------------------------
FROM node:20-bookworm-slim AS runner-build
WORKDIR /src
COPY services/build-runner/package.json services/build-runner/tsconfig.json ./
RUN npm install
COPY services/build-runner/src ./src
RUN npx tsc -p tsconfig.json

# --- Stage 3: runtime ------------------------------------------------------
# Node 24 LTS: modern SSG/static frameworks (Astro 7+, Vite 7, Next 15+)
# declare engines >=22.12, so a Node 20 runtime is not enough.
FROM node:24-bookworm-slim AS runtime

# git + the archive/binary helpers bun's installer needs.
RUN apt-get update \
    && apt-get install -y --no-install-recommends git ca-certificates curl unzip \
    && rm -rf /var/lib/apt/lists/*

# Package managers the runner may encounter in a project:
#   npm  — ships with the Node base image
#   pnpm — pinned to the repo's version via corepack
#   yarn — corepack shim (respects a project's `packageManager` field)
# The `prepare --activate` must run as the `builder` user so the pinned
# defaults land in builder's own corepack cache (HOME differs per user).
RUN corepack enable pnpm yarn

# bun — official installer, into /usr/local so every user gets it on PATH.
RUN curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

# Repos are checked out into a builder-owned workspace; don't let git's
# dubious-ownership guard abort a clone/fetch.
RUN git config --system --add safe.directory '*'

RUN useradd --create-home --shell /bin/bash builder
WORKDIR /app

# Runner (no runtime node_modules — only Node builtins + fetch).
COPY --from=runner-build /src/dist ./runner

# PageX CLI.
COPY --from=cli-build /build/cli/dist /opt/pagex-cli/dist
COPY --from=cli-build /build/cli/node_modules /opt/pagex-cli/node_modules
COPY --from=cli-build /build/cli/package.json /opt/pagex-cli/package.json

RUN mkdir -p /workspace && chown -R builder:builder /workspace /app /opt/pagex-cli
USER builder
# Default pnpm is the 9.x line: it reads lockfileVersion 6.0 AND 9.0, so
# arbitrary public repos install well out of the box. A repo that declares
# `packageManager` (e.g. pnpm@8.15.0) still gets its pinned version via the
# corepack shim, so the PageX monorepo's own pin keeps working too.
RUN corepack prepare pnpm@9.15.9 --activate \
    && corepack prepare yarn@1.22.22 --activate
ENV HOME=/home/builder \
    PAGEX_CLI_ENTRY=/opt/pagex-cli/dist/index.js \
    BUILD_WORKSPACE_DIR=/workspace \
    COREPACK_ENABLE_DOWNLOAD_PROMPT=0

# The runner drains the queue and exits; the Fly controller stops the machine.
CMD ["node", "/app/runner/index.js"]
