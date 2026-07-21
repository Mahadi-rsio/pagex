# Cloudisy — Coding Rules & Conventions

> Read this before modifying any source file. These are the patterns consistently used in this codebase. Deviating from them will create inconsistencies.

---

## Language & Module System

- **TypeScript** throughout. All files are `.ts`.
- **ESM** — all imports use `.js` extension (compiled output). **Never omit `.js`** from imports.
  ```typescript
  // ✅ correct
  import { db } from '../infrastructure/db/db.js'
  
  // ❌ wrong — will break at runtime
  import { db } from '../infrastructure/db/db'
  ```
- `tsconfig.json` targets ESM modules with strict mode.
- Compiled output goes to `dist/` — never edit `dist/` directly.

---

## File Naming

| Type | Convention | Example |
|------|-----------|---------|
| Services | `<domain>.service.ts` | `build.service.ts` |
| Controllers | `<domain>.controller.ts` | `build.controller.ts` |
| Routes | `<domain>.routes.ts` | `build.routes.ts` |
| Workers | `<domain>.worker.ts` | `build.worker.ts` |
| Queue jobs | `<domain>.queue.ts` or `<domain>.job.ts` | `build.queue.ts` |
| Validators | `<domain>.validator.ts` | `build.validator.ts` |

---

## Controller Pattern

Controllers are **thin** — they only:
1. Parse and validate the request body (Zod `safeParse`)
2. Extract `tenantId` from `(req as any).id`
3. Call a service function
4. Return the result or map errors to HTTP codes

```typescript
export async function exampleHandler(req: Request, res: Response) {
    const validate = exampleSchema.safeParse(req.body)
    if (!validate.success) {
        return res.status(400).json({ error: validate.error.format() })
    }

    const tenantId = (req as any).id
    if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })

    try {
        const result = await someService({ ...validate.data, tenantId })
        return res.status(201).json(result)
    } catch (err: any) {
        const status = err.status || 500
        return res.status(status).json({ error: err.message || 'Internal Server Error' })
    }
}
```

---

## Service Pattern

Services contain all business logic and DB/MinIO/Redis interactions.

- Services **do not** import from controllers.
- Services **may** import from `infrastructure/` and other services.
- Attach HTTP status to thrown errors:
  ```typescript
  const error = new Error("Page not found")
  ;(error as any).status = 404
  throw error
  ```

---

## Drizzle ORM Conventions

```typescript
// Always destructure the first element with !
const [record] = await db.select().from(table).where(...).limit(1)
if (!record) throw new Error("Not found")

// Use returning() after insert/update to get back the row
const [inserted] = await db.insert(table).values({...}).returning()

// Always import operators from 'drizzle-orm'
import { eq, and, desc, ne } from 'drizzle-orm'

// Never use raw SQL unless absolutely necessary
```

---

## Auth Pattern

The `authMiddleware` sets two properties on the request:
- `(req as any).id` — the tenant's unique ID (from JWT `payload.id`)
- `(req as any).name` — the tenant's name (from JWT `payload.name`)

Every protected controller **must** check for `tenantId`:
```typescript
const tenantId = (req as any).id
if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })
```

---

## Route Registration

All routes are mounted in `src/routes/index.ts`. When adding a new router:

```typescript
// 1. Create src/routes/my-feature.routes.ts
// 2. Import and use in src/routes/index.ts:
import myFeatureRouter from './my-feature.routes.js'
router.use(myFeatureRouter)
```

Route path convention: `/api/<resource>/<action>`.

---

## BullMQ Queue Pattern

```typescript
// Define the queue + interface in queue/jobs/<name>.queue.ts
export const MY_QUEUE = "my-queue-name"
export interface MyJobData { ... }
export const myQueue = new Queue<MyJobData>(MY_QUEUE, { connection })

// Add jobs from a service:
await myQueue.add('job-name', jobData, { attempts: 3, backoff: { type: 'exponential', delay: 5000 } })

// Create worker in queue/workers/<name>.worker.ts
const worker = new Worker<MyJobData>(MY_QUEUE, async (job) => {
    const { field } = job.data
    await job.updateProgress(50)
    await job.log("Step: doing something...")
}, { connection })
```

**Log format:** Use `job.log()` for all build output. Stats lines must be prefixed with `[Stats]` so the SSE handler and test scripts can identify them.

---

## MinIO Access

Always use the shared helpers from `src/infrastructure/storage/minio.ts`:
- `copyFolder(sourcePrefix, destPrefix)` — server-side copy; returns file count
- `deleteFolder(prefix)` — bulk delete all objects under prefix
- `deleteSiteObjects(siteId)` — deletes both `tenant/${siteId}/` and `snapshots/${siteId}/`
- `minioClient` — raw MinIO client for custom operations
- `SHARED_BUCKET` — always use this constant, never hardcode the bucket name

**Key prefix format:**
- Live files: `{siteId}/` (e.g. `d48da5d0-e96d-441f-980c-d7125490efdc/index.html`)
- Snapshots: `snapshots/{siteId}/v{version}/`

---

## Environment Variables

Loaded via `dotenv`. All env access should use `process.env.VAR_NAME`.

| Variable | Used in |
|----------|---------|
| `DB` | `infrastructure/db/db.ts` |
| `DRIZZLE_CONNECTION` | `drizzle.config.ts` |
| `REDIS_URL` | `infrastructure/cache/redis.ts` |
| `MINIO_ENDPOINT` | `infrastructure/storage/minio.ts` |
| `MINIO_PORT` | `infrastructure/storage/minio.ts` |
| `S3_ACCESS_KEY` | `infrastructure/storage/minio.ts` |
| `S3_SECRET_KEY` | `infrastructure/storage/minio.ts` |
| `MINIO_BUCKET` | `infrastructure/storage/minio.ts` |
| `BASE_DOMAIN` | (referenced in docker-compose / Caddy config) |

---

## Adding a New Feature Checklist

1. **Schema** (if needed): edit `src/infrastructure/db/schema.ts`, run `npm run gen`, commit migration
2. **Validator**: create `src/validators/<name>.validator.ts` with Zod schema
3. **Service**: create `src/services/<name>.service.ts` with business logic
4. **Controller**: create `src/controllers/<name>.controller.ts` — thin, calls service
5. **Routes**: create `src/routes/<name>.routes.ts`, mount in `src/routes/index.ts`
6. **Build & test**: `npm run build`, then test with `node test.js` or curl
7. **Redeploy**: `docker compose up --build -d app` (or relevant service)
8. **Update docs**: update `docs/API.md`, `docs/SCHEMA.md`, `docs/WORKERS.md` as needed

---

## What NOT To Do

- ❌ Do not import from `dist/` — always import from `src/`
- ❌ Do not skip the `.js` extension on local imports
- ❌ Do not put business logic in controllers
- ❌ Do not hardcode bucket names, queue names, or domain strings — use constants
- ❌ Do not call `deleteSiteObjects` directly in workers — use `executeDeploymentFlow`
- ❌ Do not run two simultaneous builds for the same page (no deploy lock yet)
- ❌ Do not edit `drizzle/` migration files manually after they've been applied
