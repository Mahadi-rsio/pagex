# PageX — Coding Rules & Conventions

> Read this before modifying API code in the Next.js console.

---

## TypeScript and Next.js

- Use strict TypeScript. `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes` are enabled.
- Use extensionless local imports so TypeScript, Node tests, and Next.js Turbopack resolve the same source files.
- App Router route `params` are Promises and must be awaited.
- Keep route handlers thin and server-only. They parse input, call a service, and return a `Response`.
- Do not add `middleware.ts`; auth CORS belongs in `src/proxy.ts`.

---

## File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Services | `<domain>.service.ts` | `deploy.service.ts` |
| Validators | `<domain>.validator.ts` | `deploy.validator.ts` |
| Utilities | `<domain>.ts` or `<domain>-<purpose>.ts` | `http-error.ts` |
| Native routes | `src/app/**/route.ts` | `internal/usage/ingest/route.ts` |

---

## Native API Request Flow

Public `/api/*` requests enter through `src/app/api/[...path]/route.ts` and are processed by `src/server/api/http/dispatcher.ts`.

1. Match the path and HTTP method.
2. Apply the Redis-backed public rate limit.
3. Verify the Better Auth JWT with JOSE and JWKS.
4. Validate request data with Zod.
5. Call a service in `src/server/api/services/`.
6. Map service errors to HTTP responses.

To add a route, extend `matchRoute` and `executeRoute` in the dispatcher. Keep business logic out of the dispatcher.

---

## Service Pattern

Services own business logic and PostgreSQL, Redis, and MinIO interactions.

- Services must not import route handlers or the dispatcher.
- Use `HttpError` when a service needs to control the HTTP status.
- Check the first selected or inserted row before dereferencing it.
- Use Drizzle operators instead of raw SQL unless raw SQL is necessary.

```typescript
const [page] = await db
    .select()
    .from(pages)
    .where(eq(pages.id, pageId))
    .limit(1)

if (!page) throw new HttpError("Page not found", 404)
```

---

## Authentication

Protected routes use `Authorization: Bearer <JWT>`. `authenticateRequest` verifies the signature and expiry through JWKS and returns the authenticated tenant's `id` and `name`.

The JWKS URL defaults to the request origin's `/api/auth/jwks`; `AUTH_JWKS_URL` may override it. Internal ingest is different: it compares `Authorization: Bearer <token>` against `USAGE_INGEST_TOKEN` in constant time and bypasses public rate limiting.

Every protected operation must scope database access to the authenticated `tenantId`.

---

## Drizzle ORM

- Auth schema: `src/modules/auth/schemas/auth.schema.ts`
- API schema: `src/modules/api/schemas/api.schema.ts`
- Aggregated runtime exports: `src/db/schema.ts`
- Auth config/history: `drizzle.config.ts` and `drizzle/`
- API config/history: `drizzle.api.config.ts` and `drizzle-api/`

After editing either schema, run `pnpm db:generate` and then `pnpm db:migrate`. Never edit generated migrations after they have been applied.

---

## No Job Queues

BullMQ and background build workers were removed. Deploys are synchronous through `/api/deploy/prepare`, `/api/deploy/presign`, and `/api/deploy/commit`; do not introduce queue/worker infrastructure.

---

## MinIO Access

Use helpers from `src/server/api/infrastructure/storage/minio.ts`:

- `getStorageConfig()` for the validated lazy client and bucket.
- `blobObjectKey(hash)` for `blobs/{hash}`.
- `manifestObjectKey(deploymentId)` for immutable manifests.
- `objectMetaForPath(...)` for object metadata.
- `deleteBlobObjects(...)` and `deleteManifestObjects(...)` for batch cleanup.
- `ensureSharedBucket()` for idempotent bucket creation.

Key layout:

- Live serving: `blobs/{sha256}`
- Deployment manifests: `manifests/{deploymentId}.manifest.json`

Never hardcode bucket names or copy live objects into `tenant/{siteId}/`.

---

## Environment Variables

| Variable | Used in |
|----------|---------|
| `DATABASE_URL` | `src/db/index.ts` and Drizzle configs |
| `UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis client (`src/server/api/infrastructure/cache/redis.ts`) |
| `REDIS_KEY_PREFIX` | Optional key namespace (default `px`) |
| `MINIO_ENDPOINT`, `MINIO_PORT`, `MINIO_USE_SSL` | Lazy MinIO client |
| `S3_ACCESS_KEY`, `S3_SECRET_KEY` | Lazy MinIO client |
| `MINIO_BUCKET` | Bucket selection and startup bootstrap |
| `BASE_DOMAIN` | New page domains and domain checks |
| `USAGE_INGEST_TOKEN` | Internal usage ingest authentication |
| `AUTH_JWKS_URL` | Optional native API JWKS override |

---

## Adding a Feature

1. Edit the relevant schema under `src/modules/*/schemas/` and generate migrations if needed.
2. Add a Zod validator under `src/server/api/validators/`.
3. Add business logic under `src/server/api/services/`.
4. Add route matching and request handling to the native dispatcher.
5. Add or update utility tests under `tests/`.
6. Run `pnpm test:console`, `pnpm exec tsc --noEmit` in `services/console`, and `pnpm run build`.
7. Update `docs/API.md`, `docs/SCHEMA.md`, or `docs/WORKERS.md` when contracts change.

---

## Prohibited Changes

- Do not import from `dist/` or `.next/`; import source modules.
- Do not put database, Redis, or MinIO logic in route handlers.
- Do not await `runDeploymentGC(...)` during commit or rollback.
- Do not delete MinIO blobs except through GC after cross-checking references.
- Do not run simultaneous deployments for one page; use `deploy:lock:{pageId}`.
- Do not edit applied migrations.
- Do not give Vector PostgreSQL credentials; Vector only posts to `/internal/usage/ingest`.
