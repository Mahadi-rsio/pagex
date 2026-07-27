#!/bin/sh
set -eu

STATIC_SRC="${STATIC_SRC:-/opt/static}"
STATIC_DEST="${STATIC_DEST:-/shared/static}"

if [ -d "$STATIC_SRC" ]; then
  mkdir -p "$STATIC_DEST"
  # Populate shared volume so Caddy can serve the exported UI + public assets.
  cp -a "$STATIC_SRC"/. "$STATIC_DEST"/
  chown -R nextjs:nodejs "$STATIC_DEST" 2>/dev/null || true
  echo "Synced static assets from $STATIC_SRC to $STATIC_DEST"
fi

cd /app
exec su-exec nextjs node server.js
