#!/bin/sh
# Restore the latest *non-empty* gzipped SQL dump from MinIO (backup/ prefix).
# Prefer the host wrapper (stops/starts app services for you):
#   ./scripts/db-backup/restore-stack.sh
set -eu

ALIAS="${MC_ALIAS:-pagex}"
BUCKET="${MINIO_BUCKET:?MINIO_BUCKET is required}"
PREFIX="${BACKUP_PREFIX:-backup}"
DB_NAME="${PGDATABASE:-pagex}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-postgres}"
MIN_BYTES="${BACKUP_MIN_BYTES:-2048}"

if [ "${CONFIRM:-}" != "yes" ]; then
  echo "[db-restore] Refusing to run without CONFIRM=yes" >&2
  echo "[db-restore] This DROP DATABASE / reloads ${DB_NAME}." >&2
  echo "[db-restore] Stop api + console first, then:" >&2
  echo "  docker compose exec -e CONFIRM=yes db-backup /scripts/restore.sh" >&2
  exit 1
fi

ENDPOINT_URL="${MINIO_ENDPOINT_URL:?MINIO_ENDPOINT_URL is required}"
ACCESS_KEY="${S3_ACCESS_KEY:?S3_ACCESS_KEY is required}"
SECRET_KEY="${S3_SECRET_KEY:?S3_SECRET_KEY is required}"
mc alias set "$ALIAS" "$ENDPOINT_URL" "$ACCESS_KEY" "$SECRET_KEY" >/dev/null

echo "[db-restore] Waiting for Postgres at ${PGHOST}..."
until pg_isready -h "$PGHOST" -U "$PGUSER" -d postgres >/dev/null 2>&1; do
  sleep 2
done

PREFIX_PATH="${ALIAS}/${BUCKET}/${PREFIX}"
echo "[db-restore] Looking for latest dump (≥ ${MIN_BYTES} bytes) under ${PREFIX_PATH}/"

# Prefer newest pagex-*.sql.gz whose object size is above the empty threshold.
LATEST_NAME="$(
  mc ls --json "${PREFIX_PATH}/" 2>/dev/null | while IFS= read -r line; do
    [ -n "$line" ] || continue
    KEY="$(printf '%s' "$line" | sed -n 's/.*"key":"\([^"]*\)".*/\1/p' | sed 's|.*/||')"
    SIZE="$(printf '%s' "$line" | sed -n 's/.*"size":\([0-9][0-9]*\).*/\1/p')"
    case "$KEY" in
      pagex-*.sql.gz) ;;
      *) continue ;;
    esac
    [ -n "${SIZE:-}" ] || continue
    [ "$SIZE" -ge "$MIN_BYTES" ] || continue
    printf '%s\n' "$KEY"
  done | sort | tail -n 1 || true
)"

if [ -z "$LATEST_NAME" ]; then
  echo "[db-restore] No non-empty backups found under ${PREFIX}/ (min ${MIN_BYTES} bytes)" >&2
  exit 1
fi

OBJECT_KEY="${PREFIX}/${LATEST_NAME}"
SRC="${ALIAS}/${BUCKET}/${OBJECT_KEY}"
echo "[db-restore] Latest usable backup: ${OBJECT_KEY}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DUMP_FILE="${TMP_DIR}/${LATEST_NAME}"

mc cp "$SRC" "$DUMP_FILE"
SIZE="$(wc -c <"$DUMP_FILE" | tr -d ' ')"
echo "[db-restore] Downloaded ${SIZE} bytes"

if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "[db-restore] Refusing to restore: downloaded dump is below BACKUP_MIN_BYTES=${MIN_BYTES}" >&2
  exit 1
fi

echo "[db-restore] Terminating connections to ${DB_NAME}"
psql -h "$PGHOST" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE datname = '${DB_NAME}'
  AND pid <> pg_backend_pid();
SQL

echo "[db-restore] Recreating database ${DB_NAME}"
psql -h "$PGHOST" -U "$PGUSER" -d postgres -v ON_ERROR_STOP=1 <<SQL
DROP DATABASE IF EXISTS ${DB_NAME};
CREATE DATABASE ${DB_NAME} OWNER ${PGUSER};
SQL

echo "[db-restore] Loading dump into ${DB_NAME}"
gunzip -c "$DUMP_FILE" | psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -v ON_ERROR_STOP=1

echo "[db-restore] Restore complete from ${OBJECT_KEY}"
echo "[db-restore] Restart api and console if you stopped them."
