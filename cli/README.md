# PageX CLI

CLI tool to deploy web projects to the PageX cloud platform.

## Requirements

- Node.js 18 or later
- npm (or a compatible package manager)

## Installation

```bash
npm install -g pagex
```

Or from this repository:

```bash
npm install
npm run build
npm link
```

## Quick start

```bash
pagex login
cd my-project
pagex init
pagex deploy --build
```

## Commands

| Command | Description |
|---------|-------------|
| `pagex login` | Authenticate with your PageX account (device flow) |
| `pagex logout` | Clear the saved session |
| `pagex status` | Show the current login status |
| `pagex init` | Create a new project or link an existing one (`pagex.json`) |
| `pagex deploy` | Deploy build output — prints the live site URL when done |
| `pagex pages` | List projects on your account |

### `pagex init` options

| Option | Description |
|--------|-------------|
| `--name <project>` | Create a new project with this name (non-interactive) |
| `--link <project>` | Link an existing project by name or id (non-interactive) |

### `pagex deploy` options

| Option | Description |
|--------|-------------|
| `-b, --build` | Run the project's `build` script before uploading |

### Global options

| Option | Description |
|--------|-------------|
| `--quiet` | Suppress all output except errors |
| `--verbose` | Enable verbose / debug output |
| `-v, --version` | Print version |
| `-h, --help` | Show help |

## How it works

1. **Login** — Device-flow auth; the session token is stored in `~/.pagex.session.json`.
2. **Init** — Detects the framework, then either creates a project via the API or links an existing one. Writes `pagex.json` in the project root and adds it to `.gitignore`.
3. **Deploy** — Requires login, finds an existing build folder (`dist`, `build`, `.next`, or `out`), validates the manifest locally (≤100 files, ≤50 MB/file, ≤250 MB total), then **prepare → presign → PUT originals → commit**. Pass `--build` to run the project's build script first. The CLI uploads original files only; Brotli/Gzip and WebP run on the server at commit. On success it prints the live site URL (`https://<domain>`).

The build step automatically uses the project's own package manager — pnpm, yarn, bun, or npm (detected from your lockfile).

## Configuration

Override defaults with environment variables (see `.env.example`). A `.env` file in the current
working directory is loaded automatically.

| Variable | Default | Description |
|----------|---------|-------------|
| `PAGEX_API_URL` | `http://localhost:3000` | PageX API base URL |
| `PAGEX_AUTH_URL` | `http://localhost:3000` | Auth/console base URL |
| `PAGEX_CLIENT_ID` | `pagex` | OAuth device-flow client ID |

## Supported frameworks

| Category | Frameworks |
|----------|------------|
| Frontend | React, Vue, Angular, Svelte |
| Backend | Express, Hono, Fastify, NestJS, Koa |
| Fullstack | Next.js, Nuxt, SvelteKit |
| Other | Vite, Python (`requirements.txt` / `pyproject.toml`) |

## Development

```bash
npm install
npm run build        # compile TypeScript to dist/
npm run dev          # watch mode
npm run typecheck    # typecheck without emit
npm run lint         # ESLint on src/
npm test             # Vitest
```

Entry point: `src/index.ts`. Commands live under `src/commands/` and are registered in `src/commands/index.ts`.

## License

ISC
