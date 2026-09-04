#!/bin/sh
set -eu

ALIAS="${MC_ALIAS:-pagex}"
ENDPOINT_URL="${MINIO_ENDPOINT_URL:?MINIO_ENDPOINT_URL is required}"
ACCESS_KEY="${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
SECRET_KEY="${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-1500}"
# Wait for api/console migrations before the first dump attempt.
STARTUP_GRACE_SECONDS="${BACKUP_STARTUP_GRACE_SECONDS:-90}"

echo "[db-backup] Configuring mc alias '${ALIAS}' → ${ENDPOINT_URL}"
mc alias set "$ALIAS" "$ENDPOINT_URL" "$ACCESS_KEY" "$SECRET_KEY" >/dev/null

echo "[db-backup] Waiting for Postgres at ${PGHOST:-db}..."
until pg_isready -h "${PGHOST:-db}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-pagex}" >/dev/null 2>&1; do
  sleep 2
done
echo "[db-backup] Postgres is ready. Grace=${STARTUP_GRACE_SECONDS}s Interval=${INTERVAL_SECONDS}s"

echo "[db-backup] Startup grace ${STARTUP_GRACE_SECONDS}s (avoids racing empty DB on compose up)..."
sleep "$STARTUP_GRACE_SECONDS"

while true; do
  if /scripts/backup.sh; then
    echo "[db-backup] Cycle OK"
  else
    echo "[db-backup] Cycle FAILED (exit $?)" >&2
  fi
  sleep "$INTERVAL_SECONDS"
done
