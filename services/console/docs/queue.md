# Background Jobs — Cloudflare Queues (Binding Producer + HTTP Pull) + Go Worker

Scope: `services/console` (Next.js 16 on Cloudflare Workers via OpenNext) and
`services/worker` (Go).

This document records the **implemented** design. The previous revision of this
file proposed an SQS/Lambda consumer that queued the deploy commit itself; that
was rejected. See [Why deploys stay synchronous](#why-deploys-stay-synchronous).

---

## 1. The one rule

**Deployments are fully synchronous. The queue carries only deferred cleanup.**

Everything a user waits for happens inside the request: upload → Brotli/Gzip →
commit rows → manifest → activation → Redis. Nothing about a deploy depends on
the queue being up.

Only two jobs are ever enqueued, both *after* the caller's PostgreSQL write has
committed:

| Job | Enqueued by | Effect if the queue is down |
|---|---|---|
| `deployment_gc` | deploy commit, rollback | Old deployments and their blobs are pruned later. No user-visible effect. |
| `page_delete` | `DELETE /api/pages/[id]` | Storage is reclaimed later. The project is already invisible. |

Neither failure is user-visible, so **the producer swallows every error**
(`enqueueBackgroundJob` returns `false` and logs; it never throws). A committed
deploy or delete is never rolled back by queue downtime.

---

## 2. Why deploys stay synchronous

The earlier proposal was to move the deploy commit behind an async boundary
because it buffers every file in memory. That was rejected for four reasons:

1. **Activation is a single transaction.** `commitDeploy` flips
   `deployments.is_active` inside one `db.transaction`, required by the partial
   unique index `deployments_page_id_is_active_uid`. Splitting the commit across
   a queue boundary would require a client-visible poll step and a new
   `pending`/`failed` state machine — real complexity for no user benefit.
2. **A queued commit changes the deploy contract.** The CLI and the API both
   expect a deployment to be live when the response returns. Polling is a
   breaking change to both.
3. **The memory problem has a cheaper fix.** The peak came from holding every
   file buffer plus its `.br`/`.gz` siblings at once. Removing image-variant
   generation (sharp/WebP) cut the largest contributor, and the remaining
   variant expansion is bounded by `MAX_FILE_COUNT = 100`.
4. **Queue latency would dominate the lock TTLs.** `DEPLOY_LOCK_PREPARE_TTL_SECONDS`
   (600 s) and `DEPLOY_LOCK_COMMIT_TTL_SECONDS` (360 s) are sized for an
   in-request operation. Adding p99 queue latency in front of them would make
   commits fail with `STALE_DEPLOYMENT_MESSAGE` for reasons unrelated to the
   user's build.

Cleanup is the only work that genuinely has no deadline, so it is the only work
that got an async boundary.

---

## 3. Architecture

```
services/console (Cloudflare Workers, OpenNext)
  │  env.BACKGROUND_QUEUE.send({ type, page_id, site_id, deployment_id? })
  ▼
Cloudflare Queue  "pagex-background"      ← producer binding, wrangler.jsonc
  │
  ├──▶ dead-letter queue "pagex-background-dlq"   (on exhaustion)
  ▼
HTTP pull consumer
services/worker (Go, long-lived container)
  ├── deployment_gc  → prune deployments beyond retention + orphan blobs
  └── page_delete    → delete manifests, blobs, and all project rows
```

- **Producer transport:** the native Workers Queue binding `BACKGROUND_QUEUE`,
  declared in `wrangler.jsonc`. The console never calls the Queues HTTP API, so
  it needs no `CF_ACCOUNT_ID` / `CF_QUEUE_ID` / `CF_QUEUE_API_TOKEN`.
- **Consumer transport:** unchanged — the Go worker long-polls
  `POST .../messages/pull`, which suits a container with a resident connection
  and avoids Cloudflare's per-push callback requirements. A binding producer
  writes to the *same* queue the pull consumer reads, so no consumer change was
  needed.
- **At-least-once delivery.** Every handler is idempotent; see §5.

### Producer

`services/console/src/server/api/queues/cloudflare-queue.ts`

The binding is resolved through `getCloudflareContext({ async: true })` — the
same pattern `src/server/api/infrastructure/storage/r2.ts` uses for `BLOBS` —
and reached through a small structural type (`QueueBinding`), so application
code does not depend on Wrangler types.

```jsonc
// wrangler.jsonc
"queues": {
  "producers": [{ "binding": "BACKGROUND_QUEUE", "queue": "pagex-background" }]
}
```

`env.BACKGROUND_QUEUE.send(job)` takes the job **object** directly. With the
Worker compatibility date in use, `send()` defaults to the `json` content type,
so the Go consumer's pull response still carries `body` as the serialized job —
byte-for-byte the payload the old HTTP push endpoint produced from
`{"body": <job>}`. The Go mirror (`internal/jobs/jobs.go` → `Parse`) also tolerates
a body that is itself a JSON string, so both shapes are accepted.

Behaviour (deliberately identical to the HTTP producer it replaced):

| Case | Result |
|---|---|
| Binding resolves, `send()` settles | `true` |
| Binding missing / no Worker context | warn, job dropped, `false` |
| `send()` rejects or times out (5 s) | one retry after 250 ms, then `false` |
| Any throw | caught by `enqueueBackgroundJob` → `false` |

Publishers must **await** the enqueue: a Worker isolate is frozen the moment the
response is returned, so a fire-and-forget promise is dropped.

### Consumer

`services/worker` — `go run ./cmd/worker run`

```bash
go run ./cmd/worker provision   # idempotent: create queue, DLQ, consumer
go run ./cmd/worker run         # long-lived pull loop
go run ./cmd/worker version
```

`internal/worker/consumer.go` pulls a batch, runs up to `CONCURRENCY` handlers
in parallel, then settles leases in **one** `POST .../messages/ack`:

| Outcome | Lease handling |
|---|---|
| Handler succeeded | acked |
| Handler failed, attempts remaining | retried |
| Body malformed / unknown `type` | **acked** — an unparseable message must not wedge the queue |
| Handler failed, `MAX_ATTEMPTS` exhausted | retried past the Cloudflare retry limit so the consumer's own `dead_letter_queue` moves it to the DLQ |

The last row is why the consumer is configured with a DLQ: Cloudflare routes a
message to the consumer's dead-letter queue once its retry limit is exhausted, so
the worker does not have to publish a second copy itself.

### Wrangler configuration

Only the **producer** binding belongs in `wrangler.jsonc`. There must be **no**
`queues.consumers` entry for the console:

- The consumer is a separate Go process that owns the queue through the HTTP pull
  API; it is provisioned by `go run ./cmd/worker provision`, not by Wrangler.
- A `queues.consumers` entry would register the console Worker as a push
  consumer. The Worker has no `queue()` handler, so Cloudflare would deliver
  batches that nobody processes and fight the Go pull consumer for the same
  messages.

Queue-level settings (`max_retries`, `dead_letter_queue`, retention) live on the
pull consumer created by `provision` — see §9.

---

## 4. Job contracts

`services/console/src/server/api/queues/background-job.ts` is the source of
truth; the Go mirror is `services/worker/internal/jobs/jobs.go`.

```jsonc
// deployment_gc — prune one superseded deployment
{ "type": "deployment_gc", "page_id": "<uuid>", "site_id": "<uuid>", "deployment_id": "<uuid>" }

// page_delete — reclaim everything for a soft-deleted project
{ "type": "page_delete", "page_id": "<uuid>", "site_id": "<uuid>" }
```

Every field is required and must be a string. A payload that fails validation is
ACKed and logged rather than retried, because no amount of retrying fixes a
malformed body.

---

## 5. Project deletion is two-phase

Deleting a project has to reclaim storage *and* free the subdomain, but the
storage that must be deleted is spread across MinIO/R2 and several tables. Doing
it inline would make `DELETE /api/pages/[id]` slow and would fail the request if
S3 was briefly unavailable — after the row was already gone.

So deletion is split:

### Phase 1 — console, synchronous, fast

`src/features/projects/page.service.ts` → `deletePage`

1. `UPDATE pages SET deleted_at = now()` — the project immediately disappears
   from every user-facing read.
2. `UPDATE sites SET active = false` — the blob-server stops routing to it.
3. Acquire the page's delete fence (`PAGE_DELETED_LOCK_HOLDER` sentinel).
4. Delete the routing keys (`site:subdomain:*`, active deployment, manifest).
5. Enqueue `page_delete`. If this fails, log and return success — the project is
   already gone from the user's perspective.

### Phase 2 — worker, asynchronous

`internal/cleanup/page_delete.go`

1. Re-read the page; return if it is already gone (idempotence).
2. Inventory the deployment IDs and the blob hashes, keeping any hash still
   referenced by another project.
3. **Delete objects before rows.** If a blob delete fails, the handler returns
   an error and retries; the rows stay, so a retry can still find the objects.
   Deleting rows first would orphan the objects permanently.
4. In one transaction, delete the project's rows.
5. Clear the remaining cache keys.

**The `sites` row is deliberately kept** (inactive). `sites.subdomain` is
unique, so keeping the row permanently reserves the subdomain and prevents a
future project from silently inheriting a subdomain whose objects are still being
purged from a lagging CDN cache.

---

## 6. Visibility rules

`src/server/api/utils/page-visibility.ts` defines the single predicate used to
hide soft-deleted pages:

```ts
isLivePage()  // pages.deleted_at IS NULL
withLivePage(...)
```

Applied to deployment resolution, page lookup by domain, page listing, and the
usage/metrics read paths.

**Usage ingest is deliberately NOT filtered.** Vector batches access logs, so a
request served just before a delete arrives in a later batch. `resolveTenantId`
looks up the site regardless of `deleted_at` so late usage still lands against
the right tenant instead of being silently dropped.

---

## 7. Deployment fencing

A delete that lands while a deploy commit is in flight must not be undone by the
commit activating a deployment. Two independent guards:

1. `pageDeploymentLock.assertHeld` — the Redis sentinel. Cheap, and it also stops
   the commit before it writes anything.
2. A `pages.deleted_at` re-read **inside the activation transaction**
   (`deploy.service.ts`). The Redis check is not enough on its own: a delete can
   commit after `assertHeld` passes but before the transaction. Re-reading under
   the same transaction that flips `is_active` makes the two operations mutually
   exclusive — whichever commits first wins, and a commit that loses raises
   `409`.

---

## 8. Local development

The binding works locally with **no Cloudflare credentials and no queue IDs**:

- `pnpm dev` (`next dev`) → `initOpenNextCloudflareForDev()` in `next.config.ts`
  → Wrangler's `getPlatformProxy()` loads `wrangler.jsonc`, including the
  `BACKGROUND_QUEUE` producer binding.
- `pnpm run preview` (`opennextjs-cloudflare build && preview`) uses the same
  bindings through `wrangler dev`.

### Enqueue smoke test (safe — touches nothing remote)

```bash
cd services/console
CLOUDFLARE_HYPERDRIVE_LOCAL_CONNECTION_STRING_HYPERDRIVE=$DATABASE_URL \
node --input-type=module -e '
import { getPlatformProxy } from "wrangler";
const { env, dispose } = await getPlatformProxy({ config: "./wrangler.jsonc", envFiles: [] });
await env.BACKGROUND_QUEUE.send({
  type: "page_delete",
  page_id: "00000000-0000-0000-0000-000000000000",
  site_id: "00000000-0000-0000-0000-000000000000",
});
console.log("enqueue ok");
await dispose();
'
```

`enqueue ok` proves the binding resolves and `send()` accepts the message. It
never reaches a real queue: Miniflare holds queues in memory, and with no local
consumer registered the broker accepts and drops the message.

### What cannot be tested locally

The Go consumer polls `https://api.cloudflare.com/...`, so it cannot read
Miniflare's in-memory queue. **There is no end-to-end local path** — and none
should be created by pointing local code at the production queue.

The safest practical test path, in order:

1. `pnpm run test` in `services/console` — asserts the exact message shape, the
   missing-binding path, retry/timeout behaviour, and the job contract.
2. The enqueue smoke test above — asserts the binding exists and `send()`
   resolves outside the test runner.
3. End-to-end, only when it matters: provision a **scratch** queue in a
   non-production account or name it apart from production, e.g.
   `wrangler queues create pagex-background-smoke`, point the Go worker at it
   (`CF_QUEUE_ID=<scratch id>`), temporarily change `queue` in `wrangler.jsonc`
   to the scratch name **without committing**, run `pnpm dev`, trigger a deploy
   or project delete, and watch the worker log `job processed`. Revert the
   `wrangler.jsonc` line afterwards.

Never send test cleanup jobs to `pagex-background`: a `page_delete` job is
irreversible against real project data.

---

## 9. Provisioning and deployment

The queue, DLQ, and consumer are created out of band; Wrangler does not create
them (it only *verifies* they exist — see below), and the console never creates
Cloudflare resources itself.

```bash
cd services/worker
CF_ACCOUNT_ID=... CF_QUEUE_API_TOKEN=... go run ./cmd/worker provision
```

`provision` is idempotent — it looks up each resource by name/consumer type
before creating it, so re-running it is safe. It needs only `CF_ACCOUNT_ID` and
`CF_QUEUE_API_TOKEN`; storage variables are not required on a first run
(`config.LoadForProvision`).

Queue *retention* is applied best-effort. The PATCH endpoint currently returns
HTTP 500 (Cloudflare error `10013`), so the worker logs a warning and leaves the
Cloudflare default in place rather than failing the run.

Print the resulting IDs and set them in the **worker** environment (the console
no longer reads them):

```bash
CF_ACCOUNT_ID=... CF_QUEUE_ID=... CF_QUEUE_DLQ_ID=... CF_QUEUE_API_TOKEN=...
```

### Deploying the console

1. Ensure `pagex-background` exists (`provision`, or
   `wrangler queues create pagex-background`). Deploy fails with
   `Queue "pagex-background" does not exist. To create it, run: wrangler queues create pagex-background`
   when the producer binding names a queue that is missing — Wrangler validates
   producer queues before publishing.
2. `cd services/console && pnpm run deploy`
   (= `opennextjs-cloudflare build && opennextjs-cloudflare deploy`). No
   queue-related secret or variable is required on the Worker.
3. Confirm the Worker's bindings list shows `BACKGROUND_QUEUE` →
   `pagex-background`.

Rollback of the console is unaffected by the queue: the binding is only touched
when a cleanup job is enqueued.

---

## 10. Verifying, retries, and dead letters

**Was a message enqueued?**

- Cloudflare dashboard → Workers Queues → `pagex-background`: `backlog`,
  `delivered`, `retried`, `dead-lettered` counters move per deploy/delete.
- Or `wrangler queues info pagex-background` from `services/console` (remote API,
  needs account auth).
- A *dropped* enqueue is visible in the Worker's logs as
  `[queue] ... dropped background job "<type>"` — that means the binding was
  missing or `send()` failed.

**Was it processed?**

- `services/worker` logs `job processed` (slog `INFO`) per handled job,
  `job failed` for a retriable failure, `dropping unparseable job` for a body
  that fails validation, and `moved jobs to the dead-letter queue` when retries
  are exhausted.
- In the database: `deployments` rows beyond retention disappear
  (`deployment_gc`), and the project's rows disappear (`page_delete`).

**Retry and dead-letter behaviour**

| Layer | Who | Behaviour |
|---|---|---|
| Producer | console binding | one retry after 250 ms, 5 s timeout, then the job is dropped and logged (the PostgreSQL write has already committed, so it must not fail the request) |
| Consumer | Cloudflare + Go worker | `max_retries` (3) set by `provision`, then the message lands in `pagex-background-dlq`; the worker also pushes explicitly when its own `WORKER_MAX_ATTEMPTS` budget is exhausted |
| DLQ | — | **never drained automatically**; inspect by hand and re-push to the main queue after a fix |

Delivery is at-least-once, so both handlers tolerate duplicates (§5 step 1 for
`page_delete`, retention-relative pruning for `deployment_gc`).

---

## 11. Operational notes

- **Monitoring:** the worker has no metrics endpoint. Watch the Cloudflare queue
  dashboard (depth, `ack_count` vs. retry count) and the DLQ's message count. A
  non-empty DLQ means a handler has a bug, not that the queue is down.
- **Scaling:** `CONCURRENCY` is per container. Raise it before adding replicas —
  each container opens its own pull loop and its own Postgres pool
  (`WORKER_DATABASE_MAX_CONNS`).
- **Cost:** Cloudflare Queues charges per operation. A deploy produces one
  `deployment_gc` message, so the queue cost scales with deploy count. Deletion
  produces one `page_delete` message regardless of how many deployments or blobs
  the project accumulated.
- **Redis cleanup is best-effort.** If `UPSTASH_REDIS_REST_URL`/`_TOKEN` are
  unset the worker skips cache invalidation entirely; the rows are still deleted
  and a stale cache entry expires on its own TTL.

---

## 12. Environment variables

**Removed from the console** (the HTTP producer is gone; no console code reads
them):

| Variable | Still needed? |
|---|---|
| `CF_ACCOUNT_ID` | yes — Go worker only (`provision` + runtime API calls) |
| `CF_QUEUE_ID` | yes — Go worker only (pull/ack endpoint) |
| `CF_QUEUE_DLQ_ID` | yes — Go worker only (explicit DLQ pushes) |
| `CF_QUEUE_API_TOKEN` | yes — Go worker only |

They can be deleted from the Worker's deployment environment (Wrangler vars and
secrets) but **must stay** in `services/worker`'s environment, in the root
`.env`, and in `docker-compose*.yml`. Nothing publishes with credentials
anymore — the binding needs none.

Still read by the console for the queue: nothing. The binding name comes from
`wrangler.jsonc`.

Worker-only knobs (`WORKER_*`, `CF_QUEUE_NAME`, `CF_QUEUE_DLQ_NAME`,
`CF_QUEUE_MAX_RETRIES`, `CF_QUEUE_RETENTION`) are unchanged; see
`services/worker/README.md`.

---

## 13. What is deliberately absent

| Not used | Why |
|---|---|
| Worker **consumer** binding (`queues.consumers` + `queue()` handler) | The Go worker pulls directly; a Worker consumer entry would register the console as a push consumer nobody handles, competing with the pull consumer. |
| Queues HTTP publishing from the console | Replaced by the binding: no account ID, queue ID, or API token in the request path. |
| BullMQ / Redis queue | Redis is used for caching and locks only. Upstash has one logical database, so a job queue would contend with request-path keys. |
| `waitUntil` / in-process background work | The isolate can be frozen at any time; a queue is the only durable async boundary. |
| Queued deploy commit | See §2. |
| Generated image variants | `sharp`/WebP generation was removed from the console. The blob-server still *serves* a `.webp` sibling if one is present in a manifest, which is what a user's own build output produces. |
| Cron / scheduler for GC | `deployment_gc` is enqueued per deploy. There is no periodic sweep. |
