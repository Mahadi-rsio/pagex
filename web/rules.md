# Codebase Rules & Guidelines

These guidelines ensure consistency, security, and build stability across the Next.js monolithic codebase.

---

## 🛠 1. Development & Quality

- **Linter & Formatter**: Biome is utilized for formatting and linting. Do not run Prettier or ESLint.
  - Run formatting before committing: `npm run lint`.
- **TypeScript**:
  - Enable strict type-checking. Avoid using `any` unless absolutely necessary.
  - Do not use `@ts-ignore` unless accompanied by a descriptive comment detailing why.
  - Resolve all TypeScript compilation warnings before merging.

---

## ⚡ 2. Next.js 16 (App Router) Guidelines

- **Async Route Parameters (required)**:
  - Route parameters (`params` and `searchParams` in pages, layouts, and route handlers) are **Promises**. You **must** await them before accessing properties. Synchronous access is removed in Next.js 16.
    ```typescript
    // Correct
    export default async function Page(props: { params: Promise<{ id: string }> }) {
        const { id } = await props.params;
        return <div>ID: {id}</div>;
    }
    ```
- **Proxy (formerly Middleware)**:
  - Network boundary logic lives in `src/proxy.ts` (Node.js runtime). Do not add a new `middleware.ts` unless you specifically need the Edge runtime.
- **React Server Components (RSC) vs Client Components**:
  - UI route pages under `src/app/**/page.tsx` (except thin SSG shells that only export `generateStaticParams`) are **client components** so the UI can be statically exported and served by Caddy.
  - Do **not** call `getSession()` or set `export const dynamic = "force-dynamic"` on UI pages — auth is client-side via `AuthGuard` / `authClient`.
  - Keep API route handlers and auth utilities as server-only code.
- **Data Fetching**:
  - Browser-facing session and UI data go through the auth client / public APIs. Server `getSession()` is for API/server utilities only, not page gates.

---

## 🔗 3. Environment Variables

- **Exposing to Client**:
  - By default, client-side components (`"use client"`) can only read environment variables prefixed with `NEXT_PUBLIC_`.
  - Non-prefixed variables (e.g. `PUBLIC_URL`) can also be safely exposed to the client by explicitly mapping them under the `env` property in `next.config.ts`.
- **Dynamic Origin Fallbacks**:
  - When referencing base URLs or callback URLs on the client side, use `process.env.PUBLIC_URL`. If undefined, fall back to `window.location.origin` (where the browser is running) to guarantee compatibility across environments:
    ```typescript
    const callbackUrl = process.env.PUBLIC_URL || (typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");
    ```

---

## 🗄 4. Drizzle ORM & Database Schema Rules

- **Schema Definition**:
  - All schemas must be defined under `src/modules/[module-name]/schemas/` (e.g., `src/modules/auth/schemas/auth.schema.ts`).
  - Aggregated schemas must be imported and re-exported in [src/db/schema.ts](file:///workspaces/next-web/src/db/schema.ts).
- **Migrations workflow**:
  - Never edit generated files inside the `./drizzle` or `src/drizzle` directories manually.
  - After modifying a Drizzle schema, generate SQL migrations using:
    ```bash
    npm run db:generate
    ```
  - Apply the generated migrations using:
    ```bash
    npm run db:migrate
    ```

---

## 🔒 5. Better Auth Implementation

- **Server-Side Instance**:
  - Do not instantiate `betterAuth()` repeatedly. Import and use the shared instance via `getAuthInstance()` or get the session via `getSession()` defined in [src/modules/auth/utils/auth-utils.ts](file:///workspaces/next-web/src/modules/auth/utils/auth-utils.ts).
- **Client-Side Instance**:
  - Use `authClient` imported from [src/modules/auth/utils/auth-client.ts](file:///workspaces/next-web/src/modules/auth/utils/auth-client.ts) for all client-side authentication requests (e.g. `signIn.social`, `signOut`, etc.).
