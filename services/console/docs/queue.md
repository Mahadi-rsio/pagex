# Background Jobs — Cloudflare Queues (HTTP Pull) + Go Worker

Scope: `services/console` (Next.js 16 on Vercel) and `services/worker` (Go).

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
services/console (Vercel, serverless)
  │  POST /messages  { body: { type, page_id, site_id, deployment_id? } }
  ▼
Cloudflare Queue  "pagex-background"
  │
  ├──▶ dead-letter queue "pagex-background-dlq"   (on exhaustion)
  ▼
HTTP pull consumer
services/worker (Go, long-lived container)
  ├── deployment_gc  → prune deployments beyond retention + orphan blobs
  └── page_delete    → delete manifests, blobs, and all project rows
```

- **Transport:** Cloudflare Queues HTTP API. No Worker binding, no Redis queue,
  no BullMQ. The console is a *producer*; the Go worker is the only *consumer*.
- **Pull, not push:** the worker long-polls `POST .../messages/pull`, which suits
  a container with a resident connection and avoids Cloudflare's per-push
  callback requirements.
- **At-least-once delivery.** Every handler is idempotent; see §5.

### Producer

`services/console/src/server/api/queues/cloudflare-queue.ts`

The Cloudflare push endpoint takes **one** message and requires `body` to be a
JSON **object**:

```jsonc
// POST /accounts/{account_id}/queues/{queue_id}/messages
{ "body": { "type": "page_delete", "page_id": "...", "site_id": "..." } }
```

Two shapes are silently rejected by the API — `"body": "<json string>"` ("Expected
object, received string") and a top-level `messages` array (that is the separate
`messages/batch` endpoint). Because the producer swallows errors, neither
failure would surface. `tests/queue-producer.test.ts` asserts the exact wire
shape and the retry policy (5xx retried once, 4xx not retried).

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

## 8. Provisioning

The queue, DLQ, and consumer are created out of band; the console never creates
Cloudflare resources.

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

Print the resulting IDs and set them in both the console and the worker:

```bash
CF_ACCOUNT_ID=... CF_QUEUE_ID=... CF_QUEUE_DLQ_ID=... CF_QUEUE_API_TOKEN=...
```

---

## 9. Operational notes

- **Monitoring:** the worker has no metrics endpoint. Watch the Cloudflare queue
  dashboard (depth, `ack_count` vs. retry count) and the DLQ's message count. A
  non-empty DLQ means a handler has a bug, not that the queue is down.
- **The DLQ is not drained automatically.** Inspect it by hand; messages can be
  re-pushed to the main queue after a fix.
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

## 10. What is deliberately absent

| Not used | Why |
|---|---|
| Cloudflare Worker binding | The Go worker pulls directly; a JS worker would add a hop for no benefit. |
| BullMQ / Redis queue | Redis is used for caching and locks only. Upstash has one logical database, so a job queue would contend with request-path keys. |
| Queued deploy commit | See §2. |
| Generated image variants | `sharp`/WebP generation was removed from the console. The blob-server still *serves* a `.webp` sibling if one is present in a manifest, which is what a user's own build output produces. |
| Cron / scheduler for GC | `deployment_gc` is enqueued per deploy. There is no periodic sweep. |
