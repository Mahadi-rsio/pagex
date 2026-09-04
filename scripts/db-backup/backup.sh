#!/bin/sh
set -eu

ALIAS="${MC_ALIAS:-pagex}"
BUCKET="${MINIO_BUCKET:?MINIO_BUCKET is required}"
PREFIX="${BACKUP_PREFIX:-backup}"
RETENTION_HOURS="${BACKUP_RETENTION_HOURS:-24}"
DB_NAME="${PGDATABASE:-pagex}"

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

mc cp "$DUMP_FILE" "$DEST"
echo "[db-backup] Uploaded ${DEST}"

echo "[db-backup] Pruning ${PREFIX}/ objects older than ${RETENTION_HOURS}h"
# --exec runs once per match; ignore rm failures so one bad key does not abort
mc find "${ALIAS}/${BUCKET}/${PREFIX}" --older-than "${RETENTION_HOURS}h" \
  --exec "mc rm {}" || true

echo "[db-backup] Backup complete"
