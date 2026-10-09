# @pagex/cleanup-worker

Standalone Cloudflare Worker that consumes the **`pagex-background`** Cloudflare
Queue (push consumer) and runs the platform's deferred storage cleanup, replacing
the Go worker (`services/worker`).

## Jobs

| Job           | What it does                                                                                          |
| ------------- | ----------------------------------------------------------------------------------------------------- |
| `deployment_gc` | Prune a page's inactive deployments beyond `DEPLOYMENT_RETENTION` (10) and delete truly orphaned R2 blobs + immutable manifests. The active deployment is never a target. Mirrors `services/console/src/features/deployments/gc.service.ts`. |
| `page_delete`   | Purge every trace of a soft-deleted project: deployments, blob references, manifests, R2 objects, cached Redis routing/runtime state, then hard-delete the `pages` row. |

Both handlers are **idempotent** — the queue can deliver duplicates/retries
safely. The console enqueues these jobs only *after* the matching PostgreSQL
write commits, so a failure here can leak storage but can never resurrect a
deleted project or break a live site.

## Safety guards

- `page_delete` refuses to run unless the page row is **soft-deleted**
  (`deleted_at IS NOT NULL`). Live pages are never touched; a bad/stale message
  is ACKed with a permanent-error log. A deployment's `is_active` flag is **not**
  a blocker — the console only rewrites it on deploy/rollback (never on delete),
  so a soft-deleted page usually still has one marked active.
- Blob orphan checks are **cross-page**: a content-addressed blob is only
  deleted when no deployment outside the target set still references it.
- **R2 first, DB second**: every blob/manifest for the page is confirmed deleted
  from R2 before any DB reference is dropped. Deletes run in batches of 100 with
  concurrency 10, with per-object fallback; if any object still fails, the
  handler throws so the message is retried (deletes are idempotent) rather than
  ACKing and permanently orphaning files. Only confirmed hashes reach the
  `blobs` DELETE.
- Malformed queue bodies are ACKed and logged; transient failures (DB/R2
  outages) are retried up to `max_retries` (5), then ACKed. The handler never
  throws out of `queue`, so one bad message cannot wedge a batch.
- The `sites` row is intentionally kept after `page_delete` — `sites.active =
  false` already stopped routing, and the console schema only hard-deletes the
  `pages` row. (Assumption: the Go worker behaved the same way; this worker was
  built against console-side contracts, not the Go source.)

## Bindings

Configured in `wrangler.jsonc` (same resources the console uses):

- **Queue consumer**: `pagex-background` (max_batch_size 10, max_batch_timeout
  10s, max_retries 5, max_concurrency 1)
- **R2**: `BLOBS` → `pagex-blobs-dev`
- **Hyperdrive**: `HYPERDRIVE` → `0ac41863f821462ba90a1bb5d9ad81d3`

Secrets (injected via `wrangler secret put`, never committed):

| Var                       | Required | Purpose                                      |
| ------------------------- | -------- | -------------------------------------------- |
| `UPSTASH_REDIS_REST_URL`  | no       | Redis cache purge (skipped when unset)       |
| `UPSTASH_REDIS_REST_TOKEN`| no       | Redis cache purge                            |
| `REDIS_KEY_PREFIX`        | no       | Key prefix, default `px` (matches console)   |

## Commands

```sh
pnpm install            # from repo root (workspace includes cleanup-worker)
pnpm --filter @pagex/cleanup-worker typecheck
pnpm --filter @pagex/cleanup-worker test
pnpm --filter @pagex/cleanup-worker cf-typegen   # regenerate worker-configuration.d.ts
pnpm --filter @pagex/cleanup-worker lint
pnpm --filter @pagex/cleanup-worker deploy
```

Tests use Node's built-in test runner (`node --import tsx --test tests/*.test.ts`)
with no live DB/R2/Redis — handlers run against an in-memory repo fake.

## Deploying / switching the production consumer

Deploying this Worker registers it as the push consumer for `pagex-background`,
which starts draining the queue. That is an explicit, manual step:

1. `cd cleanup-worker`
2. Set secrets: `wrangler secret put UPSTASH_REDIS_REST_URL` /
   `UPSTASH_REDIS_REST_TOKEN` (optional).
3. `wrangler deploy`
4. Validate with queue logs; the old Go worker should be stopped so deliveries
   are not double-consumed (it used HTTP pull; once the push consumer is live it
   will no longer receive deliveries).
5. Rollback: `wrangler queue consumer remove pagex-background` then redeploy
   the Go worker.

Never point local `wrangler dev --remote` at the production queue; test against
an isolated queue/local emulation only.