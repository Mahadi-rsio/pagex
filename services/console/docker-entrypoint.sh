#!/bin/sh
set -eu

cd /app

mkdir -p .next/cache
chown -R nextjs:nodejs .next

SERVER_SCRIPT="server.js"
if [ ! -f "$SERVER_SCRIPT" ]; then
    if [ -f "app/server.js" ]; then
        SERVER_SCRIPT="app/server.js"
    elif [ -f "services/console/server.js" ]; then
        SERVER_SCRIPT="services/console/server.js"
    fi
fi

exec su-exec nextjs node "$SERVER_SCRIPT"

