FROM postgres:16-alpine

ARG TARGETARCH

RUN apk add --no-cache curl ca-certificates \
  && ARCH="$TARGETARCH" \
  && if [ -z "$ARCH" ]; then ARCH="$(uname -m)"; fi \
  && case "$ARCH" in \
       amd64|x86_64) MC_ARCH=amd64 ;; \
       arm64|aarch64) MC_ARCH=arm64 ;; \
       *) echo "unsupported arch: $ARCH" >&2; exit 1 ;; \
     esac \
  && curl -fsSL "https://dl.min.io/client/mc/release/linux-${MC_ARCH}/mc" \
       -o /usr/local/bin/mc \
  && chmod +x /usr/local/bin/mc \
  && apk del curl

COPY entrypoint.sh backup.sh /scripts/
RUN chmod +x /scripts/entrypoint.sh /scripts/backup.sh

ENTRYPOINT ["/scripts/entrypoint.sh"]
