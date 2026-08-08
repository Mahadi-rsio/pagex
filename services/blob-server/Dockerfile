# PageX blob-server — custom Caddy with static_s3 plugin
# Uses a checked-in main.go + `go build` (not xcaddy) so module download
# and compile artifacts cache across builds.

# ============================================================================
# Stage 1: Build custom Caddy binary
# ============================================================================
FROM caddy:2.11.4-builder AS builder

WORKDIR /src

# Cache Go modules independently of source changes
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod \
    go mod download

# Plugin sources + custom main that blank-imports the plugin
COPY src/ ./src/
COPY cmd/ ./cmd/

RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 go build -v \
      -tags=nobadger,nomysql,nopgx \
      -ldflags="-s -w -X github.com/caddyserver/caddy/v2.CustomVersion=v2.11.4-pagex" \
      -trimpath \
      -o /usr/bin/caddy \
      ./cmd/caddy

# ============================================================================
# Stage 2: Runtime image
# ============================================================================
FROM caddy:2.11.4-alpine

COPY --from=builder /usr/bin/caddy /usr/bin/caddy
COPY tls/tls-off.conf tls/tls-on.conf /etc/caddy/tls/
