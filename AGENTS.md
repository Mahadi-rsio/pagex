<!-- codebase-memory-mcp:start -->
# Codebase Memory (codebase-memory-mcp)

This project uses **codebase-memory-mcp** — a local knowledge graph of the codebase (SQLite-backed, nothing leaves the machine). Project name in the graph: **`workspaces-pagex`** (currently 4.2k nodes / 8.3k edges). **Prefers graph tools over grep/glob/read for structural questions** — one graph query replaces dozens of file reads.

## 15 MCP tools
`index_repository`, `index_status`, `list_projects`, `delete_project`, `search_graph`, `search_code`, `trace_path`, `detect_changes`, `query_graph`, `get_graph_schema`, `get_code_snippet`, `get_architecture`, `check_index_coverage`, `manage_adr`, `ingest_traces`

## Decision matrix — pick the right tool
| Question | Use |
|----------|-----|
| Is it indexed / how fresh? | `list_projects` / `index_status` (also first after session start or compaction) |
| High-level overview (routes, layers, deps) | `get_architecture` |
| Find a symbol by name | `search_graph(name_pattern=".*DeploymentService.*")` |
| Who calls X / what does X call | `trace_path(function_name="...", direction="inbound"\|"outbound"\|"both")` |
| Read one function/class body | `get_code_snippet(qualified_name="...")` |
| Local git changes → affected symbols | `detect_changes()` (great before refactors) |
| Cross-service / complex pattern | `query_graph` (Cypher) |
| Dead code / high fan-in / fan-out | `search_graph(max_degree=0, exclude_entry_points=true)` / `min_degree=...` |
| Text / identifier literal search | `search_code` or fall back to grep |

## PageX-specific quick references
- **API routes** (43 indexed): routes are `Route`-labeled nodes under `services/api/routes/`, controllers at `services/api/controllers/`; path convention `/api/<resource>/<action>`. Find them via `search_graph(label="Route", name_pattern=".*")` or Cypher `MATCH (r:Route) RETURN r.name, r.url_path`.
- **Services / business logic**: `services/api/services/` own all logic (DB/MinIO/Redis); call chains end there, not in controllers.
- **Console modules**: `services/console/src/modules/[module]/` (schemas/, routes/, components/); schemas re-exported from `src/db/schema.ts`.
- **Blob-server**: Go `static_s3` Caddy plugin under `services/blob-server/` — has **no upstream docs**, prefer `get_code_snippet`/read over Context7.
- **Shared packages**: `packages/{config,types,utils}/` — `@pagex/*`, consumed via workspace.

## Known coverage limits (trust verified by `check_index_coverage`)
- **SQL migration files** (`services/*/drizzle/*.sql`, `*.sql`) are only partly parsed (limited SQL grammar) — don't rely on the graph for migration internals, read them.
- `.opencode/node_modules`, `.git`, and gitignored/ignored files (favicons, svg, lockfiles, `.env`) are **not indexed**.
- After you edit code, the watcher re-indexes on git change; for big refactors re-run `index_repository` and confirm with `index_status` before trusting new symbols.

## Smart-usage rules
1. **Find before you trace**: `trace_path` needs exact names — `search_graph(name_pattern=...)` first, then trace.
2. **Both directions for cross-service**: `direction="outbound"` misses inbound callers from other services — use `"both"` for impact questions.
3. **Paginate**: `search_graph` defaults to 50/page — respect `has_more`, use `offset`.
4. **Cypher limits**: `query_graph` has a 100k-row ceiling — always add a Cypher `LIMIT`.
5. **Coverage before claims**: after locating candidate paths, run `check_index_coverage` once with those paths before making negative/exhaustive claims. Clean result = "no recorded gap", not proof of completeness — read any partial/skipped/excluded ranges directly.

## Evidence tiers
- **Scout (Tier 1):** quick positive lookup, few graph calls + targeted source checks. Provisional; no absence/dead-code/exhaustive-impact claims.
- **Verify (Tier 2, default):** task-directed search, relevant trace directions, exact snippets for material claims, complete pagination.
- **Auditor (Tier 3):** bounded scope, current graph generation, complete pagination, both call directions + broader relationships when material, explicit unresolved limitations.

## When to fall back to grep/glob/read
- String literals, error messages, env names, config values
- Non-code files (Dockerfiles, shell scripts, `Caddyfile`, YAML, `.sql`)
- Graph tool results are insufficient or the symbol isn't indexed.

## Session resets & subagents
- On session start or after compaction, confirm project + freshness with `list_projects` / `index_status`, then pick an evidence tier.
- Before delegating, query the graph + coverage in the **parent**; hand the child the tier, project, generation/freshness, bounded scope, queries/pagination state, qualified symbols/paths, call-chain findings, coverage ranges/reasons, and any source fallback already done.
- A child without MCP tools must not call or claim MCP access — it works from supplied evidence and reads/greps exact source (especially every reported missed-coverage range).
<!-- codebase-memory-mcp:end -->

# AGENTS.md — PageX

Multi-tenant static site hosting platform. pnpm monorepo (pnpm@8.15.0, Node >=18) with three services and three shared packages.

## Layout

- `services/api/` — Express 5 backend, **ESM**. `server.ts` is the entrypoint. Top-level dirs: `routes/`, `controllers/`, `services/`, `validators/`, `queue/`, `infrastructure/`, `utils/`. Deploys sites, manages deployments/pages, auth, background workers (BullMQ), MinIO blob storage.
- `services/console/` — Next.js 16 App Router monolith (Better Auth, Drizzle, Zustand, shadcn/ui). Has its own detailed **`services/console/AGENTS.md` — read it before touching the console**; a lot of root-level guesses will be wrong here.
- `services/blob-server/` — Go Caddy server + custom `static_s3` plugin (`cmd/caddy`). Go tests: `pnpm test:blob-server`.
- `packages/{config,types,utils}/` — shared libs `@pagex/*`. Not directly published; consumed via workspace.

## Using mem0 (memory)

mem0 is installed (`@mem0/opencode-plugin`) and stores project-scoped memories. It persists decisions, conventions, and learnings about PageX so future sessions don't re-derive them.

- **Always pass `user_id="codespace"` and `app_id="Mahadi-rsio-pagex"`** to `search_memories`, `get_memories`, and `add_memory`. Scope is `project` by default.
- **Search before answering** anything that may depend on past work or decisions — run 2 parallel searches (one for decision-type, one for convention/project) rather than one generic query.
- **Save non-obvious facts proactively** (arch decisions, stack/version pins, conventions, env gotchas) via `add_memory` — but keep them repository-relevant and concise; don't record obvious code you can just read.
- **Writes are async** — `add_memory` returns an `event_id`; call `get_event_status` if you need to confirm persistence before relying on it.
- **Update, don't duplicate** — if a stored fact changes (e.g. a version bump or a reversed decision), `update_memory` the existing entry by ID rather than adding a new conflicting one.
- Clean up probe/test memories you add.

## Using Context7 (MCP)

Context7 is available as an MCP server (`context7`) configured in `.opencode/opencode.json`. It fetches **up-to-date library/framework docs on demand** — use it instead of relying on possibly-stale model training when the exact API/version matters:

- **Always resolve the exact library + version you're working with** (e.g. `context7 resolve drizzle-orm@0.45.2`, `express@5.x`, `better-auth@1.7.1`, `next@16`). This repo pins unusual versions (Express 5, Next 16, Zod 4, Tailwind v4, Biome 2, BullMQ 5) that differ from common defaults — never assume API shapes from memory.
- Use the `open-doc` tool on a resolved doc to pull specifics (function signatures, config options, breaking changes) only when answering a question about library behavior.
- **Version-match to what's actually in `package.json`** — don't fetch docs for a newer major than the repo uses.

Where Context7 is least helpful: the custom Go `static_s3` Caddy plugin and internal PageX services have no upstream docs — read the source instead.

## Commands (from repo root)

- Install: `pnpm install` (pnpm only — there is also a stale root `package-lock.json`; ignore it)
- Dev: `pnpm dev:api` / `pnpm dev:console` / `pnpm dev:blob-server`
- Build: `pnpm build` (all) or `pnpm build:<svc>`
- API tests: `cd services/api && pnpm test` — **WARNING: the `test`/`test:invariants` scripts reference `services/*.test.ts` files that do not exist in the repo; they fail. There are no passing API tests.** Console has no test framework. Blob-server has Go tests.
- Lint/format: `pnpm lint` → runs `npx biome format --write` (Biome **formats only**, it is not a real lint check). `services/api` has no `biome.json`.

## Two broken defaults to know about

1. **`scripts/docker.sh` (and every `pnpm docker:*` script) is broken out of the box.** It hardcodes `COMPOSE_FILE=infrastructure/docker/compose/docker-compose.yml` and requires `infrastructure/configs/.env`, but neither path exists in this repo. The real compose file is root `docker-compose.yml` and the env template is root `.env.example` (copy to `.env`). To run Docker, use `docker compose --env-file .env up -d` directly rather than the helper.
2. **API `test` scripts reference missing files** (see above). Don't run `pnpm test` expecting them to pass.

Alternative legit dev workflow that avoids Docker: run infra (Postgres, Redis, MinIO) separately and use `pnpm dev:*`. Set `IN_DOCKER_COMPOSE` appropriately in `infrastructure/cache/redis.ts` (Compose sets `1`; host scripts omit it).

## API conventions (see `docs/RULES.md` for full detail)

- **ESM: all local imports MUST have the `.js` extension** (e.g. `from '../infrastructure/db/db.js'`). Omitting it breaks at runtime.
- `tsconfig.json` is strict: `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are on — handle possibly-undefined destructures (`const [record] = ...; if (!record) throw`).
- Controllers are thin: validate with Zod `safeParse`, read `(req as any).id` as tenantId, call a service, map errors to HTTP codes.
- Services own all business logic + DB/MinIO/Redis; attach `(error as any).status = <code>` to thrown errors.
- New routers are mounted in `routes/index.ts`. Path convention `/api/<resource>/<action>`.
- **Schema lives at `infrastructure/db/schema.ts`** (drizzle.config.ts points there). Note: `docs/RULES.md` references stale `src/...` paths — the real tree has these dirs at the top level.
- Drizzle migrations live in `drizzle/` (generated by `drizzle-kit`). Never edit applied migrations.

## Drizzle workflow

- API: after editing `infrastructure/db/schema.ts`, run `pnpm db:generate` then `pnpm db:migrate`.
- Console: schemas in `src/modules/[module]/schemas/`, re-exported from `src/db/schema.ts`; `pnpm run db:generate`/`db:migrate` there.

## Env requirements

Strictly required to run anything against infra: `BETTER_AUTH_SECRET` (32+ hex chars, `openssl rand -hex 32`), `BASE_DOMAIN`, DB URL, `REDIS_URL`, `S3_ACCESS_KEY`/`S3_SECRET_KEY`, `MINIO_ENDPOINT_URL`, `MINIO_BUCKET`. Console uses `NEXT_PUBLIC_*` for client code (and `PUBLIC_URL` mapped via `next.config.ts`).

## Other repo notes

- `.gitignore` ignores `.env`, `dist/`, `.next/`, and `.agents/`.
- Docs live in `docs/` (SCHEMA, API, RULES, WORKERS, architecture, development, INFRASTRUCTURE, PROJECT). `docs/RULES.md` and `README.md` sometimes use the legacy name "Cloudisy" / stale `src/` paths (the API was moved to top-level dirs) — trust the code and root `AGENTS.md` over those paths.
- Docker images publish to GHCR on version tags: `console/v*`, `api/v*`, `blob-server/v*` (see `.github/workflows/`).
- Root `Caddyfile` reverse-proxies the console (`:3080` → console:3001) and serves tenant sites via `static_s3` with MinIO + Postgres + Redis lookups. TLS/HTTPS blocks are toggled by `TLS_CFG` (off locally, on in prod).

## Subagent usage & parallel execution

Use the `task` tool to delegate to specialized agents. Default to running independent tasks **in parallel** in a single message with multiple `task` calls.

### When to delegate vs do directly

- **Delegate** when a subtask is self-contained: file search, reading multiple files, research across the codebase, or writing a block of code that doesn't need live feedback.
- **Do directly** when the task requires tool chaining with intermediate decisions (read → decide → edit → verify), or when you need to iterate on the result before proceeding.
- **Avoid delegating** single-file reads or trivial greps — the overhead isn't worth it.

### Agent types

| Type | Use for |
|------|---------|
| `explore` | File discovery, codebase navigation, finding patterns. "quick" for 1-2 lookups, "medium" or "very thorough" for multi-file exploration. |
| `general` | Multi-step research, bulk edits, complex read-modify-write across files. |
| `codebase-memory` | Graph-verified structural queries with coverage checks. Default for callers/callees/impact analysis. |
| `codebase-memory-auditor` | Bounded-scope audits with complete pagination and both call directions. |
| `codebase-memory-scout` | Fast positive lookups (symbol exists, quick call chain). Provisional — no absence claims. |

### Parallel patterns

- **Explore + Explore**: launching two `explore` agents to search different parts of the codebase simultaneously (e.g., "find API route definitions" and "find console schema definitions").
- **Graph + Source**: one `codebase-memory` agent traces the call graph while another reads the relevant source files.
- **Research + Verify**: a `general` agent researches the solution while you verify constraints in parallel.
- **Multi-service**: independent tasks scoped to `services/api`, `services/console`, and `services/blob-server` can run as three parallel agents.

### Prompt best practices for subagents

1. **Be specific about the task and scope** — give file paths, symbol names, or search patterns. Vague prompts waste cycles.
2. **Tell the agent what to return** — "return a list of file paths with line numbers" or "return the full source of the function".
3. **Include context** — if the subagent needs prior findings, paste them into the prompt. Subagents don't share your context.
4. **Mark read-only vs write** — tell the agent if it should only research, or if it should make changes.
5. **Use `task_id` to resume** — if a subagent's result needs follow-up, resume the same session instead of starting fresh.
