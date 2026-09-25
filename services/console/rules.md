# Codebase Rules & Guidelines

## Development and Quality

- Use pnpm commands.
- Biome is the formatter; do not add Prettier or ESLint.
- Run `pnpm run lint` before finishing.
- TypeScript is strict. Avoid `any` and never use `@ts-ignore` without a documented reason.

## Next.js 16

- App Router `params` and `searchParams` are Promises and must be awaited.
- Keep API route handlers server-only and thin.
- Network-boundary logic belongs in `src/proxy.ts`; do not add `middleware.ts`.
- UI pages under `src/app/**/page.tsx` are client components. Do not make them dynamic or call server session helpers from them.
- Use extensionless local imports so TypeScript, Node tests, and Turbopack resolve the same source files.
- Use `PUBLIC_URL` on the client, falling back to `window.location.origin`.

## Native API

- Public `/api/*` requests enter through `src/app/api/[...path]/route.ts` and are handled by `src/server/api/http/dispatcher.ts`.
- Extend dispatcher matching and execution when adding an endpoint.
- Services in `src/server/api/services/` own business logic and PostgreSQL, Redis, and MinIO access.
- Validate request data with Zod under `src/server/api/validators/`.
- Use `HttpError` when a service must choose an HTTP status.
- Scope every protected database query to the authenticated tenant ID.
- Internal ingest uses `USAGE_INGEST_TOKEN` and must not use the public JWT or rate limiter.

## Environment Variables

- Client code may read `NEXT_PUBLIC_*` variables.
- `PUBLIC_URL` is safe because `next.config.ts` maps it explicitly.
- Never expose server-only secrets through `next.config.ts` or client modules.

## Drizzle

- Define schemas under `src/modules/[module]/schemas/` and re-export them from `src/db/schema.ts`.
- Auth uses `drizzle.config.ts` and `drizzle/`.
- API uses `drizzle.api.config.ts` and `drizzle-api/`.
- Never edit generated migrations after application.
- After a schema change, run `pnpm run db:generate` and `pnpm run db:migrate`.

## Better Auth

- Use the shared `getAuthInstance()` and `getSession()` from `src/modules/auth/utils/auth-utils.ts` on the server.
- Use the shared `authClient` from `src/modules/auth/utils/auth-client.ts` in client components.
- Verify protected API JWTs through JOSE and Better Auth JWKS; do not duplicate signing logic.
