# PageX worker — background cleanup consumer for the Cloudflare Queue.
#
# The worker is deliberately NOT part of the deploy request path: it only
# consumes `deployment_gc` and `page_delete` messages over the Cloudflare Queues
# HTTP Pull API. A worker outage delays cleanup but can never fail a deploy.
#
# Build from the repo root so the compose build context stays consistent:
#   docker build -f services/worker/Dockerfile -t pagex-worker services/worker

# ============================================================================
# Stage 1: Build the static binary
# ============================================================================
FROM golang:1.26-alpine AS builder

WORKDIR /src

# Cache modules independently of source changes.
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

COPY . .

# CGO off so the binary runs on a scratch-like base; -trimpath keeps build
# paths out of the image and makes the build reproducible.
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -v -trimpath \
      -ldflags="-s -w" \
      -o /usr/bin/pagex-worker \
      ./cmd/worker

# Fail the build rather than shipping a binary that cannot run the tests.
RUN --mount=type=cache,target=/go/pkg/mod \
    go vet ./...

# ============================================================================
# Stage 2: Runtime image
# ============================================================================
FROM alpine:3.22

# ca-certificates is required: the worker talks to the Cloudflare API and to
# PostgreSQL/MinIO over TLS. wget backs the compose healthcheck.
RUN apk add --no-cache ca-certificates tzdata wget && \
    adduser -D -u 10001 worker

COPY --from=builder /usr/bin/pagex-worker /usr/bin/pagex-worker

USER worker
WORKDIR /home/worker

# `worker run` is the long-lived consumer loop; override to run `provision`.
ENTRYPOINT ["/usr/bin/pagex-worker"]
CMD ["run"]
