#!/bin/sh
set -eu

ALIAS="${MC_ALIAS:-pagex}"
BUCKET="${MINIO_BUCKET:?MINIO_BUCKET is required}"
PREFIX="${BACKUP_PREFIX:-backup}"
RETENTION_HOURS="${BACKUP_RETENTION_HOURS:-24}"
DB_NAME="${PGDATABASE:-pagex}"
PGHOST="${PGHOST:-db}"
PGUSER="${PGUSER:-postgres}"
MIN_BYTES="${BACKUP_MIN_BYTES:-2048}"

# Skip upload when the DB has no rows in any public table (fresh / migrate-only).
# Do NOT use relpages/n_live_tup — those stay 0 until VACUUM/ANALYZE even when rows exist.
TABLE_COUNT="$(psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -tAc \
  "SELECT COUNT(*) FROM pg_tables WHERE schemaname = 'public'" \
  | tr -d '[:space:]')"

if [ "${TABLE_COUNT:-0}" -eq 0 ]; then
  echo "[db-backup] Skipping upload: no public tables (keeping existing MinIO backups)"
  exit 0
fi

HAS_DATA=0
TABLES="$(psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -tAc \
  "SELECT format('%I.%I', schemaname, tablename) FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")"
# shellcheck disable=SC2086
for fq in $TABLES; do
  [ -n "$fq" ] || continue
  row="$(psql -h "$PGHOST" -U "$PGUSER" -d "$DB_NAME" -tAc \
    "SELECT EXISTS (SELECT 1 FROM ${fq} LIMIT 1)" | tr -d '[:space:]')"
  if [ "$row" = "t" ]; then
    HAS_DATA=1
    break
  fi
done

if [ "$HAS_DATA" -eq 0 ]; then
  echo "[db-backup] Skipping upload: public tables exist but all are empty (tables=${TABLE_COUNT})"
  echo "[db-backup] Keeping existing MinIO backups untouched."
  exit 0
fi

echo "[db-backup] Data check OK (public_tables=${TABLE_COUNT}, has_rows=yes)"

TIMESTAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OBJECT_KEY="${PREFIX}/pagex-${TIMESTAMP}.sql.gz"
DEST="${ALIAS}/${BUCKET}/${OBJECT_KEY}"

TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
DUMP_FILE="${TMP_DIR}/pagex-${TIMESTAMP}.sql.gz"

echo "[db-backup] Starting dump of ${DB_NAME} → ${OBJECT_KEY}"

pg_dump --no-owner --no-acl | gzip -c >"$DUMP_FILE"

SIZE="$(wc -c <"$DUMP_FILE" | tr -d ' ')"
echo "[db-backup] Dump size: ${SIZE} bytes"

if [ "$SIZE" -lt "$MIN_BYTES" ]; then
  echo "[db-backup] Skipping upload: dump smaller than BACKUP_MIN_BYTES=${MIN_BYTES} (likely empty)"
  exit 0
fi

mc cp "$DUMP_FILE" "$DEST"
echo "[db-backup] Uploaded ${DEST}"

echo "[db-backup] Pruning ${PREFIX}/ objects older than ${RETENTION_HOURS}h"
mc find "${ALIAS}/${BUCKET}/${PREFIX}" --older-than "${RETENTION_HOURS}h" \
  --exec "mc rm {}" || true

echo "[db-backup] Backup complete"
