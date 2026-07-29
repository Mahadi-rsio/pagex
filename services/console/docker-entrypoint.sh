#!/bin/sh
set -eu

cd /app
exec su-exec nextjs node server.js
