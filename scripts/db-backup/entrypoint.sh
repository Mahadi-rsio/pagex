#!/bin/sh
set -eu

ALIAS="${MC_ALIAS:-pagex}"
ENDPOINT_URL="${MINIO_ENDPOINT_URL:?MINIO_ENDPOINT_URL is required}"
ACCESS_KEY="${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
SECRET_KEY="${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
INTERVAL_SECONDS="${BACKUP_INTERVAL_SECONDS:-3600}"

echo "[db-backup] Configuring mc alias '${ALIAS}' → ${ENDPOINT_URL}"
mc alias set "$ALIAS" "$ENDPOINT_URL" "$ACCESS_KEY" "$SECRET_KEY" >/dev/null

echo "[db-backup] Waiting for Postgres at ${PGHOST:-db}..."
until pg_isready -h "${PGHOST:-db}" -U "${PGUSER:-postgres}" -d "${PGDATABASE:-pagex}" >/dev/null 2>&1; do
  sleep 2
done
echo "[db-backup] Postgres is ready. Interval=${INTERVAL_SECONDS}s"

while true; do
  if /scripts/backup.sh; then
    echo "[db-backup] Cycle OK"
  else
    echo "[db-backup] Cycle FAILED (exit $?)" >&2
  fi
  sleep "$INTERVAL_SECONDS"
done
