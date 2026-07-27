# Stage 1: Build Caddy with the custom plugin
FROM caddy:2.11.4-builder AS builder

# Copy go.mod and go.sum first to cache dependency downloads
WORKDIR /src/cdx_s3
COPY go.mod go.sum ./
RUN go mod download

# Copy the rest of the source code
COPY . .

# Build Caddy with the local plugin source
RUN xcaddy build \
    --with github.com/Mahadi-rsio/cdx_s3=/src/cdx_s3

# Stage 2: Final lightweight image
FROM caddy:2.11.4-alpine

# Copy the custom-built Caddy binary from the builder
COPY --from=builder /src/cdx_s3/caddy /usr/bin/caddy

