# @pagex/build-runner

The shared remote build machine for PageX. It claims queued build jobs from the
console, clones the repo at the pinned commit, installs and builds it with the
project's own toolchain, then deploys the output through the normal PageX CLI
(`prepare → presign → upload → commit`). Artifacts land in R2 exactly as a local
deploy.

It is designed to run as a single Fly.io Machine (concurrency 1) that the
console's **build controller** starts on demand and stops when idle. There is no
persistent volume: every job runs in a throwaway temp directory.

## Job flow

1. `POST /api/builds/claim` — machine-authenticated; returns one queued build and
   a short-lived **job token** (`pxb.<buildId>.<secret>`).
2. Clone the repo at `commit_sha` (immutable — a moving branch cannot change what
   is deployed).
3. Detect package manager + framework; install, then build with a scrubbed
   environment.
4. Deploy via `pagex deploy --project <pageId> --dir <out> --json`, authenticating
   with the job token (`PAGEX_JOB_TOKEN`).
5. `POST /api/builds/{id}/complete` with the resulting `deploymentId`. The console
   verifies the deployment was actually produced by this build.
6. Logs stream to `POST /api/builds/{id}/logs`; a heartbeat renews the DB lease.

## Security model

- Build scripts are **untrusted**. They run with a minimal environment
  (`buildScriptEnv`) that contains no machine token, no job token, and no
  PageX/cloud credentials. Only `BUILD_PASSTHROUGH_ENV` entries cross the boundary.
- The job token is only exposed to the **CLI child process** during the deploy
  step (`deployEnv`), never to install/build scripts.
- Logs are redacted on the machine (`redactSecrets`) and again server-side.
- Ownership is enforced server-side: the job token is scoped to one build/project,
  and a completed build must reference its own deployment.
- Resource limits: `BUILD_TIMEOUT_MS` hard-caps clone+install+build+deploy, the
  process group is killed on timeout, log size is bounded by the console.

## Environment

| Variable | Required | Purpose |
|---|---|---|
| `CONSOLE_URL` | yes | Console origin, e.g. `https://console.example.com` |
| `BUILD_MACHINE_TOKEN` | yes | Shared secret for claim/controller endpoints |
| `WORKER_ID` | no | Lease identity (defaults to `FLY_MACHINE_ID`/hostname) |
| `BUILD_WORKSPACE_DIR` | no | Scratch parent dir (default OS temp) |
| `BUILD_TIMEOUT_MS` | no | Per-job timeout (default 20 min) |
| `BUILD_HEARTBEAT_MS` | no | Heartbeat interval (default 60 s) |
| `PAGEX_CLI_ENTRY` | no | Path to built CLI (`dist/index.js`) or bin name |
| `BUILD_PASSTHROUGH_ENV` | no | Comma list of env names allowed into builds |

## Build

```sh
# from the repository root
docker build -f services/build-runner/Dockerfile -t pagex-build-runner .
```

## Fly.io

See `fly.toml`. Set the two secrets and deploy:

```sh
fly secrets set CONSOLE_URL="https://console.example.com" \
                BUILD_MACHINE_TOKEN="<console BUILD_MACHINE_TOKEN>"
fly deploy
```

The console must also be configured with the matching secrets so it can wake and
stop the machine:

```
BUILD_MACHINE_TOKEN=<same value>
FLY_API_TOKEN=<Fly API token>
FLY_APP_NAME=pagex-build-runner
FLY_MACHINE_ID=<machine id>          # optional if the app has one machine
```

## Development

```sh
pnpm --filter @pagex/build-runner build
pnpm --filter @pagex/build-runner test
```
