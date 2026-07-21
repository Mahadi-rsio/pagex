---
name: cloudisy-server
description: >
  AI skill for working on the Cloudisy Server codebase.
  A multi-tenant static-site hosting backend built with
  Express, PostgreSQL (Drizzle ORM), Redis, BullMQ, and MinIO.
  Includes cloud builds via Docker-in-Docker, deployment snapshots,
  and instant rollback.
---

# Cloudisy Server — AI Skill Guide

## Quick Orientation

When working on this codebase, read these docs in this order:

1. **[PROJECT.md](./PROJECT.md)** — File tree, entry points, constants, MinIO layout, Redis keys
2. **[SCHEMA.md](./SCHEMA.md)** — All 5 PostgreSQL tables + Drizzle query patterns
3. **[API.md](./API.md)** — All HTTP endpoints: method, path, request shape, response shape
4. **[WORKERS.md](./WORKERS.md)** — BullMQ job data shapes + worker step-by-step logic
5. **[RULES.md](./RULES.md)** — Coding conventions, patterns, what not to do
6. **[INFRASTRUCTURE.md](./INFRASTRUCTURE.md)** — Docker services, volumes, ports, Caddy plugin

---

## Common Tasks

### Add a New API Endpoint

1. **Validator** (if body input): `src/validators/<name>.validator.ts`
   ```typescript
   export const mySchema = z.object({ field: z.string() })
   ```

2. **Service**: `src/services/<name>.service.ts`
   ```typescript
   export async function doThing(params, tenantId) { /* DB logic */ }
   ```

3. **Controller**: `src/controllers/<name>.controller.ts`
   ```typescript
   export async function myHandler(req, res) {
       const tenantId = (req as any).id
       if (!tenantId) return res.status(401).json({ error: 'Unauthorized' })
       try {
           const result = await doThing(req.body, tenantId)
           return res.json(result)
       } catch (err: any) {
           return res.status(err.status || 500).json({ error: err.message })
       }
   }
   ```

4. **Routes**: `src/routes/<name>.routes.ts`
   ```typescript
   router.get('/api/resource/:id', authMiddleware, myHandler)
   ```

5. **Register** in `src/routes/index.ts`:
   ```typescript
   import myRouter from './my.routes.js'
   router.use(myRouter)
   ```

6. Compile: `npm run build`
7. Restart: `docker compose restart app`

---

### Add a New Database Table

1. Open `src/infrastructure/db/schema.ts`
2. Import any new column types from `drizzle-orm/pg-core`
3. Add the table export (follow existing pattern — see `deployments` for a FK-heavy example)
4. Generate migration: `npm run gen`
5. Commit the new file in `drizzle/`
6. Migrations run automatically on next `docker compose up --build`

---

### Modify the Deployment Flow

The entire snapshot → delete → upload → activate → prune cycle is in:
`src/services/deployment.service.ts` → `executeDeploymentFlow()`

Both upload and build workers call this. Only modify `uploadFn` callback to change what files are uploaded.

---

### Add a New BullMQ Worker

1. **Job definition**: `src/queue/jobs/<name>.job.ts`
   ```typescript
   export const MY_QUEUE = "my-queue"
   export interface MyJobData { ... }
   export const myQueue = new Queue<MyJobData>(MY_QUEUE, { connection })
   ```

2. **Worker**: `src/queue/workers/<name>.worker.ts`
   ```typescript
   const worker = new Worker<MyJobData>(MY_QUEUE, async (job) => {
       const { field } = job.data
       await job.updateProgress(50)
       await job.log("Doing something...")
   }, { connection })
   ```

3. **Entry point**: Either add to an existing worker entry or create a new Docker service
4. Add a new `FROM ... AS <stage>` in Dockerfile and a service in `docker-compose.yml`

---

### Debug a Failed Build

```bash
# 1. Check build worker logs
docker logs build_w --tail 50

# 2. Check express app logs
docker logs express_app --tail 20

# 3. Query the builds table directly
docker exec -it postgres_db psql -U postgres -d cloudisy \
  -c "SELECT id, status, error, created_at FROM builds ORDER BY created_at DESC LIMIT 5;"

# 4. Check if orphaned build container exists
docker ps -a | grep cloudisy-build

# 5. Manually kill a stuck build container
docker kill cloudisy-build-<jobId>
```

---

### Test the Full Deployment Flow

```bash
# node test.js runs an end-to-end test:
# 1. Create a page
# 2. Trigger a cloud build (SSE stream)
# 3. List deployments
# 4. Roll back to v1

node test.js
```

Update the `TOKEN` constant in `test.js` with a valid JWT from `https://auth.cloudisy.com`.

---

### Roll Back a Deployment

```bash
# Via API
curl -X POST \
  -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/deployments/<deploymentId>/rollback

# List available deployments first
curl -H "Authorization: Bearer <token>" \
  http://localhost:3000/api/deployments/page/<pageId>
```

---

### Check MinIO Contents

```bash
# Using minio mc (if available)
mc alias set local http://localhost:9000 minioadmin minioadmin
mc ls local/cloudisy-sites/<siteId>/
mc ls local/cloudisy-sites/snapshots/<siteId>/

# Or use the MinIO console: http://localhost:9001
```

---

## Architecture Summary (one-liner per component)

| Component | One-liner |
|-----------|-----------|
| `app.ts` | Express factory: rate-limit → JSON parser → routes |
| `server.ts` | Start server, ensure MinIO bucket exists |
| `auth.middleware.ts` | JOSE JWKS verify → set `req.id`, `req.name` |
| `page.service.ts` | CRUD for pages + sites, Redis cache invalidation |
| `upload.service.ts` | Wraps `executeDeploymentFlow` with ZIP extraction |
| `build.service.ts` | Insert build row → enqueue BullMQ job → return row |
| `deployment.service.ts` | snapshot→delete→upload→activate→prune + rollback |
| `sync.service.ts` | Flush Redis counters to PostgreSQL `pages` table |
| `minio.ts` | MinIO client + `copyFolder`, `deleteFolder`, `deleteSiteObjects` |
| `build.worker.ts` | git clone → docker run (1GB RAM) → executeDeploymentFlow → finalize |
| `upload.worker.ts` | unzipper → executeDeploymentFlow |
| `sync.worker.ts` | Cron every 2 min → sync.service |
| `build.controller.ts` | trigger, status, list, SSE (1s poll → BullMQ job logs) |
| `deployment.controller.ts` | listDeployments, rollbackToDeployment |
| `page.controller.ts` | createPage, listPages, deletePage, getUsage |
| `upload.controller.ts` | multer middleware → UploadQueue.add |
