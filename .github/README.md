# GitHub Actions Workflows

## Publish blob-server to GHCR

**File:** `.github/workflows/blob-server-publish.yml`

Builds and pushes the blob-server image (Caddy + the custom `static_s3` plugin) to GitHub Container Registry.

- **Trigger:** push of a `blob-server/v*` tag (e.g. `blob-server/v1.6.0`)
- **Image:** `ghcr.io/<owner>/pagex/blob-server`
- **Tags published:** `latest`, `<version>`, `<major>.<minor>`, `<major>`, `sha-<commit>`
- **Platform:** `linux/amd64`

```bash
git tag blob-server/v1.6.0
git push origin blob-server/v1.6.0
```

The console is deployed to Vercel and is not containerized, so there is no console publish workflow and no console image. Docker only runs the blob-server and the Vector access-log pipeline.
