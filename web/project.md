# Project Context: Next.js Monolith

This project is a standard monolithic Next.js web application configured to run on Node.js/Docker (not a Cloudflare runtime), using PostgreSQL, Redis, Drizzle ORM, and Better Auth.

## 🛠 Tech Stack

- **Core Framework**: [Next.js 16](https://nextjs.org/) (App Router; dual build: static `export` UI + `standalone` API)
- **Programming Language**: [TypeScript](https://www.typescriptlang.org/)
- **Styling**: [Tailwind CSS v4](https://tailwindcss.com/) + [tw-animate-css](https://github.com/mrcat-in-box/tw-animate-css)
- **Linter & Formatter**: [Biome](https://biomejs.dev/)
- **Database ORM**: [Drizzle ORM](https://orm.drizzle.team/)
- **Database Engine**: PostgreSQL
- **Caching & Session Storage**: Redis (using `ioredis`)
- **Authentication**: [Better Auth](https://better-auth.com/) (Drizzle adapter)
- **Edge / Static**: [Caddy](https://caddyserver.com/) serves the exported UI; reverse-proxies `/api/*` to the Node container
- **Containerization**: Docker & Docker Compose

---

## 📁 Directory Structure

```text
/workspaces/next-web
├── .github/                   # GitHub workflows and settings
├── drizzle/                   # Drizzle migration files (production output)
├── public/                    # Static assets
├── src/                       # Main source code
│   ├── app/                   # Next.js App Router routes & layouts
│   │   ├── api/               # API routes (including better-auth endpoint)
│   │   │   ├── auth/          # Better Auth all-catch route [...all]
│   │   │   └── health/        # Health endpoint
│   │   ├── device/            # Device auth flow pages
│   │   ├── login/             # Login page
│   │   ├── globals.css        # Global CSS styles (Tailwind v4 imports)
│   │   ├── layout.tsx         # Main HTML layout wrapper
│   │   └── page.tsx           # Homepage view
│   ├── components/            # Shared UI components
│   ├── constants/             # Global constants
│   ├── db/                    # Drizzle connection & database schemas
│   │   ├── index.ts           # Drizzle pool initializer
│   │   └── schema.ts          # Aggregated schema exports
│   ├── lib/                   # Utility libraries and helper functions
│   └── modules/               # Domain-driven feature modules
│       └── auth/              # Authentication module
│           ├── schemas/       # Drizzle schema definitions for Auth
│           └── utils/         # Authentication utility helpers
│               ├── auth-client.ts # Client-side authClient
│               ├── auth-utils.ts  # Server-side authInstance & getSession
│               └── email.ts       # Email OTP delivery system (Brevo/SMTP)
├── wrangler.jsonc             # Cloudflare D1/Wrangler configs (legacy or alternate runtime)
├── Caddyfile                  # Site on :3000; imports caddy/snippets + caddy/routes
├── caddy/                     # Caddy snippets + full static/dynamic route map
│   ├── snippets.caddy         # dynamic_ssg / static_page helpers
│   └── routes.caddy           # app_routes (API proxy + all UI paths)
├── docker-compose.yml         # caddy (:3000), migrator, app, postgres, redis
├── docker-entrypoint.sh       # Syncs /opt/static → shared volume, then starts Node
├── Dockerfile                 # Dual-build image + migrator target (drizzle-kit migrate)
├── package.json               # Node dependencies and scripts
└── tsconfig.json              # TypeScript compilation options
```

### Production serving model

- **UI pages** are client components and statically exported (`BUILD_MODE=export` → `out/`). Auth gates run in the browser via `AuthGuard` / `authClient.useSession` — do **not** call server `getSession()` or set `force-dynamic` on pages.
- **API** (`/api/auth`, `/api/health`) runs in the Next standalone Node process (`BUILD_MODE=standalone`).
- **Migrator** (`Dockerfile` target `migrator`) runs `drizzle-kit migrate` once before `app` starts.
- **Caddy** serves HTML/`_next`/public from the shared `static_assets` volume and proxies `/api/*` to `app:3000`.
- The app entrypoint copies `/opt/static` into the shared volume on start so Caddy and the app share one artifact set.

`next.config.ts` switches on `BUILD_MODE` (`export` | `standalone`). Default local `next build` / `next dev` uses standalone.

---

## 🗄 Database Schema

The database utilizes **PostgreSQL** configured via **Drizzle ORM**. Schemas are defined in `src/modules/auth/schemas/auth.schema.ts` and aggregated in `src/db/schema.ts`.

### Tables

1. **`user`**
   - Stores user profiles.
   - Fields: `id` (PK), `name`, `email` (unique), `emailVerified`, `image`, `createdAt`, `updatedAt`, `phoneNumber` (unique), `phoneNumberVerified`.

2. **`session`**
   - Manages user sessions.
   - Fields: `id` (PK), `expiresAt`, `token` (unique), `createdAt`, `updatedAt`, `ipAddress`, `userAgent`, `userId` (FK referencing `user.id` on cascade delete).

3. **`account`**
   - Stores federated OAuth credentials (Google, GitHub, etc.) and credential-based passwords.
   - Fields: `id` (PK), `accountId`, `providerId`, `userId` (FK referencing `user.id`), credentials tokens, expiry details, and passwords.

4. **`verification`**
   - Used for email verification OTPs and phone SMS codes.
   - Fields: `id` (PK), `identifier`, `value`, `expiresAt`, `createdAt`, `updatedAt`.

5. **`jwks`**
   - Cryptographic keys for signing JWTs.
   - Fields: `id` (PK), `publicKey`, `privateKey`, `createdAt`.

6. **`deviceCode`**
   - Handles OAuth 2.0 Device Authorization flow.
   - Fields: `id` (PK), `deviceCode`, `userCode`, `userId`, `expiresAt`, `status`, `lastPolledAt`, `pollingInterval`, `clientId`, `scope`.

---

## 🔑 Environment Variables

The project requires the following environment variables. The `.env` file should be populated from `.env.example`:

- `NODE_ENV`: Current environment status (`development` or `production`).
- `PUBLIC_URL`: The client-facing URL of the application (e.g. `http://localhost:3000` behind Compose/Caddy), exposed to client components via `next.config.ts`.
- `BETTER_AUTH_URL`: The backend server endpoint for Better Auth (same public origin as Caddy, e.g. `http://localhost:3000`).
- `BETTER_AUTH_TRUSTED_ORIGINS`: Comma-separated list of origins trusted by Better Auth.
- `BETTER_AUTH_SECRET`: Secret key used to encrypt sessions and tokens.
- `DATABASE_URL`: Connection string for the PostgreSQL database.
- `REDIS_URL`: Connection string for Redis cache/session manager.
- `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET`: GitHub OAuth application credentials.
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`: Google OAuth credentials.
- `SMTP_HOST` / `SMTP_PORT` / `SENDER` / `BREVO_API_KEY`: SMTP settings for sending verification emails.
- `SMS_TOKEN`: Authorization key to send OTPs via SMS gateway API.
- `ENABLE_EMAIL_PASSWORD`: Server-side toggle for Better Auth email/password (`true`/`false`).
- `NEXT_PUBLIC_ENABLE_EMAIL_PASSWORD`: Client-side toggle to show/hide email/password UI on `/login`.
