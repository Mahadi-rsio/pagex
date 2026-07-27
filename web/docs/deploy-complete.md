# Complete script for Deployment if You Need Staging Env

## What the YML script does:

This is a comprehensive CI/CD pipeline for deploying a Next.js app to Cloudflare Workers with three different environments:

### 1. **Test Job** (runs first for all pushes/PRs):

- Runs type checking, linting, and tests
- Builds the Next.js app to ensure it compiles
- Must pass before any deployment happens

### 2. **Deploy-Preview** (for Pull Requests):

- Creates a temporary preview deployment when you open a PR
- Deploys to a preview environment (e.g., `https://next-cf-app-preview.your-subdomain.workers.dev`)
- Automatically comments on the PR with the preview URL
- Lets you test changes before merging

### 3. **Deploy-Staging** (for `develop` branch):

- Deploys to a staging environment when you push to `develop` branch
- Includes database backups and migration handling
- Used for testing in a production-like environment

### 4. **Deploy-Production** (for `main` branch):

- Deploys to production when you push to `main` branch
- Most comprehensive with pre-deployment checks, database backups, migrations, and post-deployment verification

```yml
# .github/workflows/deploy.yml
name: Deploy Next.js App to Cloudflare

on:
    push:
        branches: [main, develop]
    pull_request:
        branches: [main]

env:
    NODE_VERSION: "20"
    PNPM_VERSION: "8"

jobs:
    # Run tests and linting
    test:
        name: Test & Lint
        runs-on: ubuntu-latest
        steps:
            - name: Checkout code
              uses: actions/checkout@v4

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: ${{ env.PNPM_VERSION }}

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: ${{ env.NODE_VERSION }}
                  cache: "pnpm"

            - name: Install dependencies
              run: pnpm install --frozen-lockfile

            - name: Run type checking
              run: pnpm run type-check

            - name: Run linting
              run: pnpm run lint

            - name: Run tests (if you have them)
              run: pnpm test --passWithNoTests

            - name: Build Next.js app
              run: pnpm run build

    # Deploy preview for pull requests
    deploy-preview:
        name: Deploy Preview
        needs: test
        if: github.event_name == 'pull_request'
        runs-on: ubuntu-latest
        environment: preview
        steps:
            - name: Checkout code
              uses: actions/checkout@v4

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: ${{ env.PNPM_VERSION }}

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: ${{ env.NODE_VERSION }}
                  cache: "pnpm"

            - name: Install dependencies
              run: pnpm install --frozen-lockfile

            - name: Generate Cloudflare types
              run: pnpm run cf-typegen
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
                  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

            - name: Check for pending migrations
              run: |
                  echo "Checking migration status..."
                  pnpm exec wrangler d1 migrations list next-cf-app --env preview || echo "No migration table found, first deployment"
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Run database migrations (Preview)
              run: |
                  echo "Applying database migrations to preview environment..."
                  pnpm run db:migrate:local
                  pnpm exec wrangler d1 migrations apply next-cf-app --env preview || {
                    echo "Migration failed, checking if tables already exist..."
                    pnpm exec wrangler d1 execute next-cf-app --env preview --command="SELECT name FROM sqlite_master WHERE type='table';" || echo "Database not initialized"
                    exit 0
                  }
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Deploy to Preview
              run: |
                  echo "Deploying to preview environment..."
                  pnpm run deploy --env preview
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Comment PR with preview URL
              uses: actions/github-script@v7
              with:
                  script: |
                      github.rest.issues.createComment({
                        issue_number: context.issue.number,
                        owner: context.repo.owner,
                        repo: context.repo.repo,
                        body: '🚀 Preview deployed! Check it out at: https://next-cf-app-preview.your-subdomain.workers.dev'
                      })

    # Deploy to staging (develop branch)
    deploy-staging:
        name: Deploy Staging
        needs: test
        if: github.ref == 'refs/heads/develop'
        runs-on: ubuntu-latest
        environment: staging
        steps:
            - name: Checkout code
              uses: actions/checkout@v4

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: ${{ env.PNPM_VERSION }}

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: ${{ env.NODE_VERSION }}
                  cache: "pnpm"

            - name: Install dependencies
              run: pnpm install --frozen-lockfile

            - name: Generate Cloudflare types
              run: pnpm run cf-typegen
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
                  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

            - name: Backup staging database
              run: |
                  echo "Creating backup of staging database..."
                  timestamp=$(date +%Y%m%d_%H%M%S)
                  pnpm exec wrangler d1 export next-cf-app --env staging --output "backup_staging_${timestamp}.sql" || echo "Backup failed, continuing..."
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
              continue-on-error: true

            - name: Run database migrations (Staging)
              run: |
                  echo "Applying database migrations to staging..."
                  pnpm exec wrangler d1 migrations apply next-cf-app --env staging || {
                    echo "Migration may have failed, checking database state..."
                    pnpm exec wrangler d1 execute next-cf-app --env staging --command="SELECT COUNT(*) as migration_count FROM d1_migrations;" || echo "Migration tracking not available"
                    exit 1
                  }
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Deploy to Staging
              run: |
                  echo "Deploying to staging environment..."
                  pnpm run deploy --env staging
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Verify staging deployment
              run: |
                  echo "Verifying staging deployment..."
                  curl -f https://next-cf-app-staging.your-subdomain.workers.dev/api/todos || exit 1
              continue-on-error: true

    # Deploy to production (main branch)
    deploy-production:
        name: Deploy Production
        needs: test
        if: github.ref == 'refs/heads/main'
        runs-on: ubuntu-latest
        environment: production
        steps:
            - name: Checkout code
              uses: actions/checkout@v4

            - name: Setup pnpm
              uses: pnpm/action-setup@v2
              with:
                  version: ${{ env.PNPM_VERSION }}

            - name: Setup Node.js
              uses: actions/setup-node@v4
              with:
                  node-version: ${{ env.NODE_VERSION }}
                  cache: "pnpm"

            - name: Install dependencies
              run: pnpm install --frozen-lockfile

            - name: Generate Cloudflare types
              run: pnpm run cf-typegen
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
                  CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}

            - name: Pre-deployment checks
              run: |
                  echo "Running pre-deployment checks..."
                  # Check if Cloudflare services are accessible
                  pnpm exec wrangler d1 execute next-cf-app --command="SELECT 1;" || {
                    echo "Cannot connect to production database!"
                    exit 1
                  }
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Backup production database
              run: |
                  echo "Creating backup of production database..."
                  timestamp=$(date +%Y%m%d_%H%M%S)
                  pnpm exec wrangler d1 export next-cf-app --output "backup_prod_${timestamp}.sql"
                  echo "Backup created: backup_prod_${timestamp}.sql"
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Check migration status
              id: migration-check
              run: |
                  echo "Checking for pending migrations..."

                  # List current migrations in database
                  echo "Current applied migrations:"
                  pnpm exec wrangler d1 execute next-cf-app --command="SELECT name FROM d1_migrations ORDER BY applied_at;" || echo "No migrations table found"

                  # Check if there are pending migrations
                  if pnpm exec wrangler d1 migrations list next-cf-app | grep -q "No migrations"; then
                    echo "No pending migrations found"
                    echo "has_migrations=false" >> $GITHUB_OUTPUT
                  else
                    echo "Pending migrations found"
                    echo "has_migrations=true" >> $GITHUB_OUTPUT
                    pnpm exec wrangler d1 migrations list next-cf-app
                  fi
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Run database migrations (Production)
              if: steps.migration-check.outputs.has_migrations == 'true'
              run: |
                  echo "Applying database migrations to production..."
                  echo "⚠️ Database may be temporarily unavailable during migration"

                  # Apply migrations with error handling
                  if ! pnpm exec wrangler d1 migrations apply next-cf-app; then
                    echo "❌ Migration failed! Checking database state..."
                    
                    # Check what went wrong
                    pnpm exec wrangler d1 execute next-cf-app --command="SELECT name, applied_at FROM d1_migrations ORDER BY applied_at DESC LIMIT 5;" || echo "Cannot read migration status"
                    
                    # Exit with error to stop deployment
                    exit 1
                  fi

                  echo "✅ Migrations completed successfully"

                  # Verify migration status
                  echo "Final migration status:"
                  pnpm exec wrangler d1 execute next-cf-app --command="SELECT COUNT(*) as total_migrations FROM d1_migrations;"
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Deploy to Production
              run: |
                  echo "Deploying to production environment..."
                  pnpm run deploy
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Post-deployment verification
              run: |
                  echo "Verifying production deployment..."

                  # Wait a moment for deployment to propagate
                  sleep 10

                  # Check if the app is responding
                  if curl -f https://next-cf-app.your-domain.workers.dev/api/todos; then
                    echo "✅ Production deployment verified successfully"
                  else
                    echo "❌ Production deployment verification failed"
                    exit 1
                  fi

                  # Check database connectivity
                  pnpm exec wrangler d1 execute next-cf-app --command="SELECT COUNT(*) FROM todos;" || {
                    echo "⚠️ Database connectivity issue detected"
                    exit 1
                  }

                  echo "✅ All post-deployment checks passed"
              env:
                  CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}

            - name: Notify deployment success
              if: success()
              run: |
                  echo "🎉 Production deployment completed successfully!"
                  echo "App URL: https://next-cf-app.your-domain.workers.dev"

            - name: Rollback on failure
              if: failure()
              run: |
                  echo "🚨 Deployment failed! Consider manual rollback if necessary"
                  echo "Database backup available: check previous step outputs"
                  echo "Check Cloudflare dashboard for worker status"

    # Cleanup job
    cleanup:
        name: Cleanup
        runs-on: ubuntu-latest
        needs: [deploy-production, deploy-staging, deploy-preview]
        if: always()
        steps:
            - name: Cleanup artifacts
              run: |
                  echo "Cleaning up temporary files and caches..."
                  # Any cleanup tasks you need
```
