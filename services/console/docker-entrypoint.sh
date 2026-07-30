#!/bin/sh
set -eu

cd /app

mkdir -p .next/cache
chown -R nextjs:nodejs .next

exec su-exec nextjs node server.js
