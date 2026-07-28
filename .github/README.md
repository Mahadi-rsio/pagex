# GitHub Actions Workflows

This directory contains GitHub Actions workflows for PageX.

## Available Workflows

### Docker Publish to GHCR

**File:** `.github/workflows/docker-publish.yml`

**Purpose:** Builds and pushes Docker images for `api`, `console`, and `blob-server` to GitHub Container Registry (GHCR).

#### Triggers

- **Push to main/master branches** - Builds and pushes images with branch-based tags
- **Tag pushes (v*)** - Builds and pushes images with version tags + multi-arch support
- **Pull Requests** - Builds images but does NOT push (for testing)
- **Manual dispatch** - Can trigger via GitHub UI with optional `force-push` parameter

#### Image Tags

The workflow automatically creates the following tags:

- `latest` - Always points to the most recent build on main branch
- `sha-<commit-hash>` - Unique tag for each commit
- `<branch>-<sha>` - Branch-specific tags
- `<version>` - Semantic version tags (from git tags like `v1.0.0`)
- `<major>.<minor>` - Major.minor version tags
- `<major>` - Major version tags

#### Multi-Architecture Support

For version tags (v*), the workflow builds **multi-arch images** supporting:
- `linux/amd64`
- `linux/arm64`

This allows the same image to run on both x86_64 and ARM64 servers.

#### Usage

1. **Automatic on push:** Images are automatically built and pushed when you push to main/master or create a tag.

2. **Manual trigger:**
   ```bash
   # Trigger via GitHub UI or API
   # Or create a tag:
   git tag v1.0.0
   git push origin v1.0.0
   ```

3. **Pull images:**
   ```bash
   # Pull latest
   docker pull ghcr.io/mahadi-rsio/pagex/api:latest
   docker pull ghcr.io/mahadi-rsio/pagex/console:latest
   docker pull ghcr.io/mahadi-rsio/pagex/blob-server:latest

   # Pull specific version
   docker pull ghcr.io/mahadi-rsio/pagex/api:v1.0.0
   docker pull ghcr.io/mahadi-rsio/pagex/console:v1.0.0
   docker pull ghcr.io/mahadi-rsio/pagex/blob-server:v1.0.0
   ```

## Docker Compose Files

### Root docker-compose.yml

**Purpose:** Production-ready compose file that pulls pre-built images from GHCR.

**Features:**
- Pulls `api`, `console`, and `blob-server` from GHCR
- Builds infrastructure services (PostgreSQL, Redis, PgBouncer) locally
- Builds migration containers locally
- Optional worker services (sync-worker, build-worker, build-env)

**Usage:**
```bash
# Start production stack with pre-built images
docker compose -f docker-compose.yml up -d

# Start with workers
docker compose -f docker-compose.yml --profile workers up -d

# Stop
docker compose -f docker-compose.yml down
```

### Development docker-compose.yml

**File:** `infrastructure/docker/compose/docker-compose.yml`

**Purpose:** Development compose file that builds all services locally.

**Usage:**
```bash
# Start full development stack
docker compose -f infrastructure/docker/compose/docker-compose.yml up -d

# Or use the helper script
pnpm docker:up
```

## Authentication

The workflows use GitHub's built-in `GITHUB_TOKEN` for authentication to GHCR. No additional secrets are required for basic functionality.

For private repositories or additional security, you may need to configure:
- `secrets.GITHUB_TOKEN` with repo scope
- `secrets.DOCKER_USERNAME` and `secrets.DOCKER_PASSWORD` for external registries

## Customization

### Change Registry

To use a different container registry (Docker Hub, AWS ECR, etc.):

1. Update the `REGISTRY` and `IMAGE_NAME_*` environment variables in the workflow
2. Update the login step to use your registry credentials
3. Update the image names in your docker-compose files

### Add New Services

To add a new service to the publish workflow:

1. Add a new entry to the `matrix.service` in the workflow
2. Specify the context, dockerfile, and image_name for the new service
3. Update your docker-compose files to use the new image

### Custom Tags

To customize the tagging strategy, modify the `tags` section in the metadata action step.

## Best Practices

1. **Use version tags for production:** Always deploy specific versions (v1.0.0) rather than `latest`
2. **Test PR builds:** Pull request builds are available for testing before merging
3. **Clean up old images:** Regularly clean up old images from GHCR to save space
4. **Use multi-arch for production:** Version tags automatically build multi-arch images

## Troubleshooting

### Permission Denied

Ensure your `GITHUB_TOKEN` has `packages: write` permission. For organization repositories, you may need to grant additional permissions.

### Build Failures

Check the workflow logs for specific errors. Common issues:
- Missing Dockerfile in specified context
- Syntax errors in Dockerfile
- Missing dependencies in build context

### Image Not Found

Verify:
- The workflow completed successfully
- The tag exists in GHCR
- You're logged in to GHCR: `docker login ghcr.io`
- You have permission to pull the image

## Cleanup

To clean up old images from GHCR:

1. Go to your package in GitHub (https://github.com/users/<your-username>/packages)
2. Select the package (e.g., `pagex/api`)
3. Go to "Package settings" → "Danger Zone" → "Delete package"
4. Or use the GitHub API to automate cleanup

Alternatively, use the `ghcr.io` cleanup API or tools like `ghcr-cleanup`.
